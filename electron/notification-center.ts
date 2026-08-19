import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { BrowserWindow, Notification } from 'electron'
import type {
  AppNotification,
  AppNotificationType,
  NotificationActivation,
  NotificationContext,
  NotificationSettings,
  NotificationSnapshot,
  StartPtyRequest,
} from './contracts'

const DESKTOP_BURST_WINDOW_MS = 600
const MAX_ACTIVE_NOTIFICATIONS = 10

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  desktopEnabled: true,
  needsAttention: true,
  failed: true,
  completed: true,
}

const PRIORITY: Record<AppNotificationType, number> = {
  failed: 5,
  needs_attention: 4,
  account_changed: 3,
  completed: 2,
  info: 1,
}

interface CreateNotificationInput {
  request: StartPtyRequest
  type: AppNotificationType
  dedupeKey: string
}

interface ActiveNotification extends AppNotification {
  dedupeKey: string
}

function parseSettings(value: unknown): NotificationSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_SETTINGS
  const candidate = value as Partial<NotificationSettings>
  return {
    enabled: candidate.enabled === true,
    desktopEnabled: candidate.desktopEnabled !== false,
    needsAttention: candidate.needsAttention !== false,
    failed: candidate.failed !== false,
    completed: candidate.completed !== false,
  }
}

function notificationTypeEnabled(settings: NotificationSettings, type: AppNotificationType): boolean {
  if (type === 'failed') return settings.failed
  if (type === 'completed') return settings.completed
  if (type === 'needs_attention') return settings.needsAttention
  return true
}

function notificationMessage(type: AppNotificationType): string {
  if (type === 'failed') return 'Session failed'
  if (type === 'completed') return 'Session completed'
  if (type === 'needs_attention') return 'Session may need attention'
  if (type === 'account_changed') return 'Account changed'
  return 'Session activity'
}

export class NotificationCenter {
  private readonly active = new Map<string, ActiveNotification>()
  private readonly mutedSessionIds = new Set<string>()
  private readonly nativeNotifications = new Set<Notification>()
  private readonly pendingDesktopSessionIds = new Set<string>()
  private settings: NotificationSettings
  private context: NotificationContext = { activeSessionId: '', activeView: 'none' }
  private version = 0
  private desktopTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly settingsPath: string,
    private readonly getWindow: () => BrowserWindow | null,
  ) {
    this.settings = this.readSettings()
  }

  snapshot(): NotificationSnapshot {
    return {
      version: this.version,
      notifications: [...this.active.values()]
        .sort((left, right) => PRIORITY[right.type] - PRIORITY[left.type] || right.createdAt - left.createdAt)
        .map(({ dedupeKey: _dedupeKey, ...notification }) => notification),
      settings: { ...this.settings },
      mutedSessionIds: [...this.mutedSessionIds],
    }
  }

  updateSettings(update: Partial<NotificationSettings>): NotificationSnapshot {
    const nextSettings = parseSettings({ ...this.settings, ...update })
    this.writeSettings(nextSettings)
    this.settings = nextSettings
    if (!this.settings.enabled) this.clearRuntimeState()
    else this.emit()
    return this.snapshot()
  }

  updateContext(context: NotificationContext): void {
    this.context = {
      activeSessionId: typeof context.activeSessionId === 'string' ? context.activeSessionId : '',
      activeView: ['cli', 'conversation', 'none'].includes(context.activeView) ? context.activeView : 'none',
    }
  }

  handleStartFailure(request: StartPtyRequest): void {
    this.create({ request, type: 'failed', dedupeKey: `start:${request.id}` })
  }

  handleExit(request: StartPtyRequest, exitCode: number, intentional: boolean): void {
    if (intentional) return
    const type: AppNotificationType = exitCode === 0 ? 'completed' : 'failed'
    this.create({ request, type, dedupeKey: `exit:${request.id}:${exitCode}` })
  }

  dismiss(id: string): NotificationSnapshot {
    for (const [sessionId, notification] of this.active) {
      if (notification.id !== id) continue
      this.active.delete(sessionId)
      this.pendingDesktopSessionIds.delete(sessionId)
      this.emit()
      break
    }
    return this.snapshot()
  }

  acknowledgeSession(sessionId: string): NotificationSnapshot {
    if (this.active.delete(sessionId)) {
      this.pendingDesktopSessionIds.delete(sessionId)
      this.emit()
    }
    return this.snapshot()
  }

  setSessionMuted(sessionId: string, muted: boolean): NotificationSnapshot {
    if (muted) {
      this.mutedSessionIds.add(sessionId)
      this.active.delete(sessionId)
      this.pendingDesktopSessionIds.delete(sessionId)
    } else {
      this.mutedSessionIds.delete(sessionId)
    }
    this.emit()
    return this.snapshot()
  }

  clear(): NotificationSnapshot {
    if (this.active.size || this.pendingDesktopSessionIds.size) {
      this.active.clear()
      this.pendingDesktopSessionIds.clear()
      this.emit()
    }
    return this.snapshot()
  }

  dispose(): void {
    clearTimeout(this.desktopTimer)
    this.desktopTimer = undefined
    this.pendingDesktopSessionIds.clear()
    for (const notification of this.nativeNotifications) notification.close()
    this.nativeNotifications.clear()
  }

  private create({ request, type, dedupeKey }: CreateNotificationInput): void {
    if (!this.settings.enabled || !notificationTypeEnabled(this.settings, type)) return
    if (request.purpose === 'login' || this.mutedSessionIds.has(request.sessionId)) return

    const window = this.getWindow()
    const viewingSameSession = window?.isFocused()
      && this.context.activeSessionId === request.sessionId
      && this.context.activeView === 'cli'
    if (viewingSameSession) return

    const existing = this.active.get(request.sessionId)
    if (existing?.dedupeKey === dedupeKey) return
    if (existing && PRIORITY[existing.type] > PRIORITY[type]) return

    if (!existing && this.active.size >= MAX_ACTIVE_NOTIFICATIONS) {
      const replacement = [...this.active.values()].sort((left, right) => (
        PRIORITY[left.type] - PRIORITY[right.type] || left.createdAt - right.createdAt
      ))[0]
      if (replacement && PRIORITY[replacement.type] > PRIORITY[type]) return
      if (replacement) {
        this.active.delete(replacement.sessionId)
        this.pendingDesktopSessionIds.delete(replacement.sessionId)
      }
    }

    const notification: ActiveNotification = {
      id: randomUUID(),
      sessionId: request.sessionId,
      agentId: request.agentId,
      accountId: request.account?.id ?? '',
      accountLabel: request.account?.email ?? '',
      type,
      title: request.title?.trim() || request.agentId,
      createdAt: Date.now(),
      dedupeKey,
    }
    this.active.set(request.sessionId, notification)
    this.emit()

    if (this.settings.desktopEnabled && !window?.isFocused() && Notification.isSupported()) {
      this.pendingDesktopSessionIds.add(request.sessionId)
      this.scheduleDesktopDelivery()
    }
  }

  private scheduleDesktopDelivery(): void {
    clearTimeout(this.desktopTimer)
    this.desktopTimer = setTimeout(() => this.flushDesktopDelivery(), DESKTOP_BURST_WINDOW_MS)
  }

  private flushDesktopDelivery(): void {
    this.desktopTimer = undefined
    const window = this.getWindow()
    if (!this.settings.enabled || !this.settings.desktopEnabled || window?.isFocused()) {
      this.pendingDesktopSessionIds.clear()
      return
    }

    const items = [...this.pendingDesktopSessionIds]
      .map((sessionId) => this.active.get(sessionId))
      .filter((item): item is ActiveNotification => Boolean(item && !item.desktopDeliveredAt))
    this.pendingDesktopSessionIds.clear()
    if (!items.length) return

    const deliveredAt = Date.now()
    for (const item of items) item.desktopDeliveredAt = deliveredAt
    this.emit()

    const activation: NotificationActivation = items.length === 1
      ? { kind: 'session', sessionId: items[0].sessionId }
      : { kind: 'panel' }
    const nativeNotification = new Notification(items.length === 1
      ? { title: items[0].title, body: notificationMessage(items[0].type), silent: true }
      : { title: 'MoaCLI', body: `${items.length} sessions have new activity`, silent: true })
    this.nativeNotifications.add(nativeNotification)
    nativeNotification.once('click', () => this.activate(activation))
    nativeNotification.once('close', () => this.nativeNotifications.delete(nativeNotification))
    nativeNotification.show()
  }

  private activate(activation: NotificationActivation): void {
    const window = this.getWindow()
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    window.webContents.send('notifications:activate', activation)
  }

  private clearRuntimeState(): void {
    clearTimeout(this.desktopTimer)
    this.desktopTimer = undefined
    this.active.clear()
    this.pendingDesktopSessionIds.clear()
    for (const notification of this.nativeNotifications) notification.close()
    this.nativeNotifications.clear()
    this.emit()
  }

  private emit(): void {
    this.version += 1
    const window = this.getWindow()
    if (window && !window.isDestroyed()) window.webContents.send('notifications:changed', this.snapshot())
  }

  private readSettings(): NotificationSettings {
    try {
      if (!existsSync(this.settingsPath)) return DEFAULT_SETTINGS
      return parseSettings(JSON.parse(readFileSync(this.settingsPath, 'utf8')) as unknown)
    } catch {
      return DEFAULT_SETTINGS
    }
  }

  private writeSettings(settings: NotificationSettings): void {
    mkdirSync(dirname(this.settingsPath), { recursive: true })
    const temporaryPath = `${this.settingsPath}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(settings, null, 2), 'utf8')
    renameSync(temporaryPath, this.settingsPath)
  }
}

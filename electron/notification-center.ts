import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { BrowserWindow, Notification } from 'electron'
import type {
  AppNotification,
  AppNotificationType,
  DelegationTask,
  NotificationActivation,
  NotificationContext,
  NotificationSettings,
  NotificationSnapshot,
  StartPtyRequest,
} from './contracts'
import type { DelegationTaskEvent } from './delegation-tasks'

const DESKTOP_BURST_WINDOW_MS = 600
const MAX_ACTIVE_NOTIFICATIONS = 10
const DELEGATION_TITLE_CHARS = 80

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
  sessionId: string
  agentId: string
  accountId: string
  accountLabel: string
  title: string
  type: AppNotificationType
  dedupeKey: string
  body: string
  activation: NotificationActivation
  // Skip when the user is already looking at the session's terminal.
  skipWhenViewingCli: boolean
}

interface ActiveNotification extends AppNotification {
  dedupeKey: string
  body: string
  activation: NotificationActivation
}

export function delegationNotificationKey(taskId: string): string {
  return `delegation:${taskId}`
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

function sessionMessage(type: AppNotificationType): string {
  if (type === 'failed') return 'Session failed'
  if (type === 'completed') return 'Session completed'
  if (type === 'needs_attention') return 'Session needs attention'
  if (type === 'account_changed') return 'Account changed'
  return 'Session activity'
}

function delegationTitle(task: DelegationTask): string {
  const compact = task.promptPreview.replace(/\s+/g, ' ').trim()
  const preview = compact.length <= DELEGATION_TITLE_CHARS ? compact : `${compact.slice(0, DELEGATION_TITLE_CHARS)}…`
  return `Delegation: ${preview || task.agent}`
}

export class NotificationCenter {
  private readonly active = new Map<string, ActiveNotification>()
  private readonly mutedSessionIds = new Set<string>()
  private readonly nativeNotifications = new Map<Notification, Set<string>>()
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
        .map(({ dedupeKey: _dedupeKey, body: _body, activation: _activation, ...notification }) => notification),
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
    this.createForSession(request, 'failed', `start:${request.id}`)
  }

  handleNeedsAttention(request: StartPtyRequest, signalKey: string): void {
    this.createForSession(request, 'needs_attention', `attention:${request.id}:${signalKey}`)
  }

  handleExit(request: StartPtyRequest, exitCode: number, intentional: boolean): void {
    if (intentional) return
    const type: AppNotificationType = exitCode === 0 ? 'completed' : 'failed'
    this.createForSession(request, type, `exit:${request.id}:${exitCode}`)
  }

  // Delegated tasks surface like sessions: approval requests need attention,
  // and the outcome lands as completed/failed.
  handleDelegation(task: DelegationTask, event: DelegationTaskEvent): void {
    const type: AppNotificationType = event === 'awaiting_approval' ? 'needs_attention' : event
    const body = event === 'awaiting_approval'
      ? 'Delegation awaiting your approval'
      : event === 'completed' ? 'Delegated task completed' : 'Delegated task failed'
    this.create({
      sessionId: delegationNotificationKey(task.id),
      agentId: task.agent,
      accountId: task.accountId ?? '',
      accountLabel: task.accountEmail ?? task.caller,
      title: delegationTitle(task),
      type,
      dedupeKey: `delegation:${task.id}:${event}`,
      body,
      activation: { kind: 'delegation', taskId: task.id },
      skipWhenViewingCli: false,
    })
  }

  dismiss(id: string): NotificationSnapshot {
    for (const [sessionId, notification] of this.active) {
      if (notification.id !== id) continue
      this.active.delete(sessionId)
      this.pendingDesktopSessionIds.delete(sessionId)
      this.closeNativeNotificationsForSession(sessionId)
      this.emit()
      break
    }
    return this.snapshot()
  }

  acknowledgeSession(sessionId: string): NotificationSnapshot {
    const activeRemoved = this.active.delete(sessionId)
    const pendingRemoved = this.pendingDesktopSessionIds.delete(sessionId)
    const nativeRemoved = this.closeNativeNotificationsForSession(sessionId)
    if (activeRemoved || pendingRemoved || nativeRemoved) this.emit()
    return this.snapshot()
  }

  setSessionMuted(sessionId: string, muted: boolean): NotificationSnapshot {
    if (muted) {
      this.mutedSessionIds.add(sessionId)
      this.active.delete(sessionId)
      this.pendingDesktopSessionIds.delete(sessionId)
      this.closeNativeNotificationsForSession(sessionId)
    } else {
      this.mutedSessionIds.delete(sessionId)
    }
    this.emit()
    return this.snapshot()
  }

  clear(): NotificationSnapshot {
    if (this.active.size || this.pendingDesktopSessionIds.size || this.nativeNotifications.size) {
      this.active.clear()
      this.pendingDesktopSessionIds.clear()
      this.closeAllNativeNotifications()
      this.emit()
    }
    return this.snapshot()
  }

  dispose(): void {
    clearTimeout(this.desktopTimer)
    this.desktopTimer = undefined
    this.pendingDesktopSessionIds.clear()
    this.closeAllNativeNotifications()
  }

  private createForSession(request: StartPtyRequest, type: AppNotificationType, dedupeKey: string): void {
    if (request.purpose === 'login') return
    this.create({
      sessionId: request.sessionId,
      agentId: request.agentId,
      accountId: request.account?.id ?? '',
      accountLabel: request.account?.email ?? '',
      title: request.title?.trim() || request.agentId,
      type,
      dedupeKey,
      body: sessionMessage(type),
      activation: { kind: 'session', sessionId: request.sessionId },
      skipWhenViewingCli: true,
    })
  }

  private create(input: CreateNotificationInput): void {
    if (!this.settings.enabled || !notificationTypeEnabled(this.settings, input.type)) return
    if (this.mutedSessionIds.has(input.sessionId)) return

    const window = this.getWindow()
    const viewingSameSession = input.skipWhenViewingCli
      && window?.isFocused()
      && this.context.activeSessionId === input.sessionId
      && this.context.activeView === 'cli'
    if (viewingSameSession) return

    const existing = this.active.get(input.sessionId)
    if (existing?.dedupeKey === input.dedupeKey) return
    if (existing && PRIORITY[existing.type] > PRIORITY[input.type]) return

    if (!existing && this.active.size >= MAX_ACTIVE_NOTIFICATIONS) {
      const replacement = [...this.active.values()].sort((left, right) => (
        PRIORITY[left.type] - PRIORITY[right.type] || left.createdAt - right.createdAt
      ))[0]
      if (replacement && PRIORITY[replacement.type] > PRIORITY[input.type]) return
      if (replacement) {
        this.active.delete(replacement.sessionId)
        this.pendingDesktopSessionIds.delete(replacement.sessionId)
      }
    }

    const notification: ActiveNotification = {
      id: randomUUID(),
      sessionId: input.sessionId,
      agentId: input.agentId,
      accountId: input.accountId,
      accountLabel: input.accountLabel,
      type: input.type,
      title: input.title,
      createdAt: Date.now(),
      dedupeKey: input.dedupeKey,
      body: input.body,
      activation: input.activation,
    }
    this.active.set(input.sessionId, notification)
    this.emit()

    if (this.settings.desktopEnabled && !window?.isFocused() && Notification.isSupported()) {
      this.pendingDesktopSessionIds.add(input.sessionId)
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

    const activation: NotificationActivation = items.length === 1 ? items[0].activation : { kind: 'panel' }
    const nativeNotification = new Notification(items.length === 1
      ? { title: items[0].title, body: items[0].body, silent: true }
      : { title: 'MoaCLI', body: `${items.length} sessions have new activity`, silent: true })
    this.nativeNotifications.set(nativeNotification, new Set(items.map((item) => item.sessionId)))
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
    this.closeAllNativeNotifications()
    this.emit()
  }

  private closeNativeNotificationsForSession(sessionId: string): boolean {
    let changed = false
    for (const [notification, sessionIds] of this.nativeNotifications) {
      if (!sessionIds.delete(sessionId)) continue
      changed = true
      if (sessionIds.size) continue
      this.nativeNotifications.delete(notification)
      notification.close()
    }
    return changed
  }

  private closeAllNativeNotifications(): void {
    const notifications = [...this.nativeNotifications.keys()]
    this.nativeNotifications.clear()
    for (const notification of notifications) notification.close()
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

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
import type { AgentEvent } from '../src/features/sessions/agent-event'
import type { NotificationTrace } from './attention-diagnostics'
import { compactNotificationText, delegatedNotificationContent, desktopNotificationBody, sessionNotificationContent, type NotificationContent } from './notification-content'
import { agentEventNotificationType, DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATION_PRIORITY as PRIORITY, notificationTypeEnabled, parseNotificationSettings as parseSettings } from '../src/features/notifications/notification-policy'

const DESKTOP_BURST_WINDOW_MS = 600
const MAX_ACTIVE_NOTIFICATIONS = 10

interface CreateNotificationInput extends NotificationContent {
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
  event?: AgentEvent
}

interface ActiveNotification extends AppNotification {
  dedupeKey: string
  body: string
  activation: NotificationActivation
}

export function delegationNotificationKey(taskId: string): string {
  return `delegation:${taskId}`
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
    private readonly trace?: (terminal: string, stage: NotificationTrace, name: string) => void,
  ) {
    this.settings = this.readSettings()
  }

  snapshot(): NotificationSnapshot {
    return {
      version: this.version,
      notifications: [...this.active.values()]
        .sort((left, right) => PRIORITY[right.type] - PRIORITY[left.type] || right.createdAt - left.createdAt)
        .map(({ dedupeKey: _dedupeKey, activation: _activation, ...notification }) => notification),
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
      activeView: ['cli', 'conversation', 'review', 'none'].includes(context.activeView) ? context.activeView : 'none',
    }
  }

  handleStartFailure(request: StartPtyRequest): void {
    this.createForSession(request, 'failed', `start:${request.id}`)
  }

  handleAgentEvent(request: StartPtyRequest, event: AgentEvent, generation: number): void {
    if (request.purpose === 'login') return
    // A subsequent response supersedes an earlier approval/failure, regardless
    // of display priority. Clear even when that new category is muted.
    this.acknowledgeSession(request.sessionId)
    const type = agentEventNotificationType(event)
    if (!type) { this.trace?.(request.id, 'notification-state-only', event.name); return }
    const result = this.createForSession(request, type, `event:${request.id}:${generation}`, event)
    if (result) this.trace?.(request.id, result, event.name)
  }

  handleExit(request: StartPtyRequest, exitCode: number, intentional: boolean): void {
    if (intentional) return
    this.acknowledgeSession(request.sessionId)
    const type: AppNotificationType = exitCode === 0 ? 'completed' : 'failed'
    this.createForSession(request, type, `exit:${request.id}:${exitCode}`, undefined, exitCode)
  }

  // Delegated tasks surface like sessions: approval requests need attention,
  // and the outcome lands as completed/failed.
  handleDelegation(task: DelegationTask, event: DelegationTaskEvent): void {
    const type: AppNotificationType = event === 'awaiting_approval' ? 'approval_required' : event
    const content = delegatedNotificationContent(task, event)
    this.acknowledgeSession(delegationNotificationKey(task.id))
    this.create({
      sessionId: delegationNotificationKey(task.id),
      agentId: task.agent,
      accountId: task.accountId ?? '',
      accountLabel: task.accountEmail ?? task.caller,
      title: compactNotificationText((task.source ?? task.reviewSource)?.title || 'Delegated task', 80),
      type,
      dedupeKey: `delegation:${task.id}:${event}`,
      ...content,
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

  private createForSession(request: StartPtyRequest, type: AppNotificationType, dedupeKey: string, event?: AgentEvent, exitCode?: number): NotificationTrace | undefined {
    if (request.purpose === 'login') return
    return this.create({
      sessionId: request.sessionId,
      agentId: request.agentId,
      accountId: request.account?.id ?? '',
      accountLabel: request.account?.email ?? '',
      title: compactNotificationText(request.title?.trim() || request.agentId, 80),
      type,
      dedupeKey,
      ...sessionNotificationContent(request, type, event, exitCode),
      event,
      activation: { kind: 'session', sessionId: request.sessionId },
      skipWhenViewingCli: true,
    })
  }

  private create(input: CreateNotificationInput): NotificationTrace {
    if (!this.settings.enabled || !notificationTypeEnabled(this.settings, input.type)) return 'notification-disabled'
    if (this.mutedSessionIds.has(input.sessionId)) return 'notification-muted'

    const window = this.getWindow()
    const viewingSameSession = input.skipWhenViewingCli
      && window?.isFocused()
      && this.context.activeSessionId === input.sessionId
      && this.context.activeView === 'cli'
    if (viewingSameSession) return 'notification-viewing'

    const existing = this.active.get(input.sessionId)
    if (existing?.dedupeKey === input.dedupeKey) return 'notification-deduplicated'
    if (existing && PRIORITY[existing.type] > PRIORITY[input.type]) return 'notification-capacity'

    if (!existing && this.active.size >= MAX_ACTIVE_NOTIFICATIONS) {
      const replacement = [...this.active.values()].sort((left, right) => (
        PRIORITY[left.type] - PRIORITY[right.type] || left.createdAt - right.createdAt
      ))[0]
      if (replacement && PRIORITY[replacement.type] > PRIORITY[input.type]) return 'notification-capacity'
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
      event: input.event,
      dedupeKey: input.dedupeKey,
      body: input.body,
      context: input.context,
      preview: input.preview,
      actionHint: input.actionHint,
      activation: input.activation,
    }
    this.active.set(input.sessionId, notification)
    this.emit()

    if (this.settings.desktopEnabled && !window?.isFocused() && Notification.isSupported()) {
      this.pendingDesktopSessionIds.add(input.sessionId)
      this.scheduleDesktopDelivery()
    }
    return 'notification-shown'
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
      ? { title: items[0].title, body: desktopNotificationBody(items[0], this.settings.desktopPreviewEnabled), silent: true }
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
      if (!existsSync(this.settingsPath)) return { ...DEFAULT_NOTIFICATION_SETTINGS }
      return parseSettings(JSON.parse(readFileSync(this.settingsPath, 'utf8')) as unknown)
    } catch {
      return { ...DEFAULT_NOTIFICATION_SETTINGS }
    }
  }

  private writeSettings(settings: NotificationSettings): void {
    mkdirSync(dirname(this.settingsPath), { recursive: true })
    const temporaryPath = `${this.settingsPath}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(settings, null, 2), 'utf8')
    renameSync(temporaryPath, this.settingsPath)
  }
}

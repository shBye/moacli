import type { AppNotificationType, NotificationSettings } from '../../../electron/contracts'
import type { AgentEvent } from '../sessions/agent-event'

export const DEFAULT_NOTIFICATION_SETTINGS: Readonly<NotificationSettings> = {
  enabled: false, desktopEnabled: true, needsAttention: true,
  approvals: true, inputRequired: true, failed: true, completed: true,
}

export const NOTIFICATION_PRIORITY: Record<AppNotificationType, number> = {
  failed: 5, approval_required: 4, input_required: 4, needs_attention: 4,
  account_changed: 3, completed: 2, info: 1,
}

export function parseNotificationSettings(value: unknown): NotificationSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_NOTIFICATION_SETTINGS }
  const candidate = value as Partial<NotificationSettings>
  const attention = candidate.needsAttention !== false
  return {
    enabled: candidate.enabled === true,
    desktopEnabled: candidate.desktopEnabled !== false,
    needsAttention: attention,
    // Preserve an existing user's disabled attention preference when migrating.
    approvals: typeof candidate.approvals === 'boolean' ? candidate.approvals : attention,
    inputRequired: typeof candidate.inputRequired === 'boolean' ? candidate.inputRequired : attention,
    failed: candidate.failed !== false,
    completed: candidate.completed !== false,
  }
}

export function notificationTypeEnabled(settings: NotificationSettings, type: AppNotificationType): boolean {
  if (type === 'approval_required') return settings.approvals
  if (type === 'input_required') return settings.inputRequired
  if (type === 'failed') return settings.failed
  if (type === 'completed') return settings.completed
  if (type === 'needs_attention') return settings.needsAttention
  return true
}

export function agentEventNotificationType(event: AgentEvent): AppNotificationType | null {
  switch (event.kind) {
    case 'approval_required': return 'approval_required'
    case 'input_required': return 'input_required'
    case 'response_completed': return 'completed'
    case 'response_failed': return 'failed'
    case 'processing': return null
    case 'attention': return 'needs_attention'
  }
}

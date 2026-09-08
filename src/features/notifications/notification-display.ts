import type { AppNotification } from '../../../electron/contracts'
import { agentEventLabel } from '../sessions/agent-event'

export function notificationTypeLabel(notification: AppNotification): string {
  if (notification.event) return agentEventLabel(notification.event)
  if (notification.type === 'approval_required') return 'Approval required'
  if (notification.type === 'input_required') return 'Your answer is needed'
  if (notification.type === 'failed') return 'Failed'
  if (notification.type === 'completed') return 'Completed'
  if (notification.type === 'needs_attention') return 'Needs attention'
  if (notification.type === 'account_changed') return 'Account changed'
  return 'Activity'
}

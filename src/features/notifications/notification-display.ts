import type { AppNotification } from '../../../electron/contracts'

export function notificationTypeLabel(notification: AppNotification): string {
  if (notification.type === 'failed') return 'Failed'
  if (notification.type === 'completed') return 'Completed'
  if (notification.type === 'needs_attention') return 'Needs attention'
  if (notification.type === 'account_changed') return 'Account changed'
  return 'Activity'
}

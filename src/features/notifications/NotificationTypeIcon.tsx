import { Bell, Check, TriangleAlert } from 'lucide-react'
import type { AppNotification } from '../../../electron/contracts'

export function NotificationTypeIcon({ notification, size = 13 }: { notification: AppNotification; size?: number }) {
  if (notification.type === 'failed') return <TriangleAlert size={size} />
  if (notification.type === 'completed') return <Check size={size} />
  return <Bell size={size} />
}

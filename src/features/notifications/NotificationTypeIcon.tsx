import { Bell, Check, MessageCircle, Shield, TriangleAlert } from 'lucide-react'
import type { AppNotification } from '../../../electron/contracts'

export function NotificationTypeIcon({ notification, size = 13 }: { notification: AppNotification; size?: number }) {
  if (notification.type === 'failed') return <TriangleAlert size={size} />
  if (notification.type === 'completed') return <Check size={size} />
  if (notification.type === 'approval_required') return <Shield size={size} />
  if (notification.type === 'input_required') return <MessageCircle size={size} />
  return <Bell size={size} />
}

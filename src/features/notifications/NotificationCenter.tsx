import { CheckCheck, X } from 'lucide-react'
import type { AgentHealth, AppNotification, NotificationSnapshot } from '../../../electron/contracts'
import { AgentAvatar } from '../../components/AgentAvatar'
import type { AgentIconPreference } from '../agent-icons/types'
import { notificationTypeLabel } from './notification-display'
import { NotificationTypeIcon } from './NotificationTypeIcon'

interface NotificationCenterProps {
  snapshot: NotificationSnapshot
  open: boolean
  profilesById: ReadonlyMap<string, AgentHealth>
  agentIcons: Readonly<Record<string, AgentIconPreference>>
  onClose: () => void
  onClear: () => void
  onOpen: (notification: AppNotification) => void
  onDismiss: (notificationId: string) => void
}

export function notificationTimeLabel(createdAt: number): string {
  return new Date(createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function NotificationCenter({
  snapshot,
  open,
  profilesById,
  agentIcons,
  onClose,
  onClear,
  onOpen,
  onDismiss,
}: NotificationCenterProps) {
  const count = snapshot.notifications.length
  return (
    <>
      {open && (
        <>
          <button className="notification-dismiss-layer" aria-label="Close notifications" onClick={onClose} />
          <section className="notification-panel" aria-label="Notifications" aria-live="polite">
            <header>
              <div>
                <h2>Notifications</h2>
                <span>{count} active</span>
              </div>
              <div className="notification-panel-actions">
                <button className="icon-button" title="Clear all" disabled={!count} onClick={onClear}>
                  <CheckCheck size={15} />
                </button>
                <button className="icon-button" title="Close" onClick={onClose}><X size={15} /></button>
              </div>
            </header>
            <div className="notification-list scroll">
              {snapshot.notifications.map((notification) => {
                const profile = profilesById.get(notification.agentId)
                return (
                  <div className={`notification-row ${notification.type}`} key={notification.id}>
                    <button className="notification-open" onClick={() => onOpen(notification)}>
                      <AgentAvatar
                        agentId={notification.agentId}
                        className="tinted"
                        color={profile?.color ?? '#7e878d'}
                        preference={agentIcons[notification.agentId] ?? { mode: 'monogram' }}
                      />
                      <span className="notification-copy">
                        <span className="notification-kind">
                          <NotificationTypeIcon notification={notification} size={12} />{notificationTypeLabel(notification)}
                        </span>
                        <strong title={notification.title}>{notification.title}</strong>
                        <small>
                          {profile?.label ?? notification.agentId}
                          {notification.accountLabel ? ` · ${notification.accountLabel}` : ''}
                          {` · ${notificationTimeLabel(notification.createdAt)}`}
                        </small>
                      </span>
                    </button>
                    <button className="notification-dismiss" title="Dismiss" onClick={() => onDismiss(notification.id)}>
                      <X size={13} />
                    </button>
                  </div>
                )
              })}
              {!snapshot.settings.enabled && <p className="notification-empty">Notifications are off</p>}
              {snapshot.settings.enabled && !count && <p className="notification-empty">No active notifications</p>}
            </div>
          </section>
        </>
      )}
    </>
  )
}

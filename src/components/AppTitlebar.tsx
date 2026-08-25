import { Bell, BellOff, Copy, Minus, PanelLeftClose, PanelLeftOpen, Settings2, Square, X } from 'lucide-react'
import moaCliIcon from '../assets/moacli-icon.png'

interface AppTitlebarProps {
  sidebarCollapsed: boolean
  maximized: boolean
  notificationsEnabled: boolean
  notificationCount: number
  notificationPanelOpen: boolean
  onToggleNotifications: () => void
  onOpenSettings: () => void
  onToggleSidebar: () => void
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}

export function AppTitlebar({
  sidebarCollapsed,
  maximized,
  notificationsEnabled,
  notificationCount,
  notificationPanelOpen,
  onToggleNotifications,
  onOpenSettings,
  onToggleSidebar,
  onMinimize,
  onToggleMaximize,
  onClose,
}: AppTitlebarProps) {
  return (
    <header className="titlebar" onDoubleClick={onToggleMaximize}>
      <div className="titlebar-brand">
        <button
          className="titlebar-sidebar-toggle"
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-expanded={!sidebarCollapsed}
          aria-controls="app-sidebar"
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={onToggleSidebar}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
        <div className="titlebar-app-identity">
          <img className="brand-logo" src={moaCliIcon} alt="" draggable={false} />
          <strong>MoaCLI</strong>
        </div>
      </div>
      <div className="titlebar-trailing" onDoubleClick={(event) => event.stopPropagation()}>
        <div className="titlebar-actions">
          <button
            className={`titlebar-action ${notificationCount ? 'has-items' : ''}`}
            title={notificationsEnabled ? 'Notifications' : 'Notifications are off'}
            aria-label="Notifications"
            aria-expanded={notificationPanelOpen}
            onClick={onToggleNotifications}
          >
            {notificationsEnabled ? <Bell size={15} /> : <BellOff size={15} />}
            {notificationCount > 0 && <span className="notification-count">{notificationCount}</span>}
          </button>
          <button className="titlebar-action" title="Settings" aria-label="Settings" onClick={onOpenSettings}>
            <Settings2 size={15} />
          </button>
        </div>
        <div className="window-controls">
          <button title="Minimize" onClick={onMinimize}><Minus size={16} /></button>
          <button title={maximized ? 'Restore' : 'Maximize'} onClick={onToggleMaximize}>
            {maximized ? <Copy size={12} style={{ transform: 'scaleX(-1)' }} /> : <Square size={12} />}
          </button>
          <button className="window-close" title="Close" onClick={onClose}><X size={16} /></button>
        </div>
      </div>
    </header>
  )
}

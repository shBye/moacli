import { Minus, PanelLeftClose, PanelLeftOpen, Square, X } from 'lucide-react'
import moaCliIcon from '../assets/moacli-icon.png'

interface AppTitlebarProps {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}

export function AppTitlebar({
  sidebarCollapsed,
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
      <div className="window-controls" onDoubleClick={(event) => event.stopPropagation()}>
        <button title="Minimize" onClick={onMinimize}><Minus size={16} /></button>
        <button title="Maximize or restore" onClick={onToggleMaximize}><Square size={12} /></button>
        <button className="window-close" title="Close" onClick={onClose}><X size={16} /></button>
      </div>
    </header>
  )
}

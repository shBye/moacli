import type { DragEvent as ReactDragEvent } from 'react'
import { MessagesSquare, RefreshCw } from 'lucide-react'
import type { HistorySession } from '../../../electron/contracts'
import { AgentAvatar } from '../../components/AgentAvatar'
import { SectionHeading } from '../../components/SectionHeading'
import type { AgentIconPreference } from '../agent-icons/types'
import type { LogicalFolder } from '../folders/types'
import type { DraggedSidebarItem } from './types'

interface SidebarRecentSectionProps {
  open: boolean
  history: readonly HistorySession[]
  activeHistoryKey: string
  draggedItem: DraggedSidebarItem | null
  folderAssignments: Readonly<Record<string, string>>
  folders: readonly LogicalFolder[]
  resolvedAgentIcon: (agentId: string) => AgentIconPreference
  onToggle: () => void
  onRefresh: () => void
  onResume: (session: HistorySession) => void
  onStartDrag: (event: ReactDragEvent<HTMLElement>, item: DraggedSidebarItem) => void
  onFinishDrag: () => void
  onOpenAccountSettings: () => void
}

export function SidebarRecentSection({
  open,
  history,
  activeHistoryKey,
  draggedItem,
  folderAssignments,
  folders,
  resolvedAgentIcon,
  onToggle,
  onRefresh,
  onResume,
  onStartDrag,
  onFinishDrag,
  onOpenAccountSettings,
}: SidebarRecentSectionProps) {
  return (
    <>
      <SectionHeading
        className={open ? '' : 'docked'}
        label="Recent"
        count={history.length}
        open={open}
        onToggle={onToggle}
        actions={<button className="mini-icon-button" title="Refresh conversations" onClick={onRefresh}><RefreshCw size={13} /></button>}
      />
      {open && (
        <nav className="history-list" aria-label="Recent conversations">
          {history.map((historySession) => (
            <button
              className={`history-session ${activeHistoryKey === historySession.key ? 'active' : ''} ${draggedItem?.kind === 'history' && draggedItem.key === historySession.key ? 'dragging' : ''}`}
              draggable
              key={historySession.key}
              onClick={() => onResume(historySession)}
              onDragStart={(event) => onStartDrag(event, { kind: 'history', key: historySession.key })}
              onDragEnd={onFinishDrag}
            >
              <AgentAvatar agentId={historySession.agentId} className="neutral" preference={resolvedAgentIcon(historySession.agentId)} />
              <span className="session-copy">
                <strong title={historySession.title}>{historySession.title}</strong>
                <small>
                  {historySession.agentId} · {new Date(historySession.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  {folderAssignments[historySession.key] && <span className="history-folder-label"> · {folders.find((folder) => folder.id === folderAssignments[historySession.key])?.name}</span>}
                </small>
              </span>
            </button>
          ))}
          {!history.length && (
            <div className="sidebar-empty">
              <MessagesSquare size={18} aria-hidden="true" />
              <p>Past conversations from connected accounts show up here.</p>
              <button onClick={onOpenAccountSettings}>Connect an account</button>
            </div>
          )}
        </nav>
      )}
    </>
  )
}

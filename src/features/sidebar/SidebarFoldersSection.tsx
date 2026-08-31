import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronsDownUp, ChevronsUpDown, EllipsisVertical, Folder, FolderLock, FolderOpen, FolderPlus, Lock, LockOpen, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { AgentHealth, AppNotification, HistorySession } from '../../../electron/contracts'
import { AgentAvatar } from '../../components/AgentAvatar'
import { SectionHeading } from '../../components/SectionHeading'
import type { AgentIconPreference } from '../agent-icons/types'
import type { FolderView, LogicalFolder } from '../folders/types'
import { notificationTypeLabel } from '../notifications/notification-display'
import { NotificationTypeIcon } from '../notifications/NotificationTypeIcon'
import type { RuntimeSession } from '../sessions/types'
import type { DraggedSidebarItem, FolderDropIndicator } from './types'

interface SidebarFoldersSectionProps {
  open: boolean
  recentOpen: boolean
  folders: readonly LogicalFolder[]
  folderViews: ReadonlyMap<string, FolderView>
  selectedFolderId: string
  newFolderName: string | null
  draggedItem: DraggedSidebarItem | null
  dragOverFolderId: string
  dropIndicator: FolderDropIndicator | null
  removingEntry: string
  activeSessionId: string
  profilesById: ReadonlyMap<string, AgentHealth>
  notificationsBySessionId: ReadonlyMap<string, AppNotification>
  folderPaneHeight: number
  folderPaneHeightRange: readonly [number, number]
  folderTreeRef: Ref<HTMLElement>
  folderSessionRefs: { current: Map<string, HTMLDivElement> }
  resolvedAgentIcon: (agentId: string) => AgentIconPreference
  onToggle: () => void
  onNewFolder: () => void
  onNewSession: () => void
  onToggleFolder: (folderId: string) => void
  onToggleFolderLock: (folderId: string) => void
  onCollapseAll: () => void
  onFolderDragEnter: (folderId: string) => void
  onFolderDragLeave: () => void
  onFolderDragOver: (event: ReactDragEvent<HTMLElement>, folderId: string) => void
  onDropIntoFolder: (event: ReactDragEvent<HTMLElement>, folderId: string) => void
  onStartItemDrag: (event: ReactDragEvent<HTMLElement>, item: DraggedSidebarItem) => void
  onFinishItemDrag: () => void
  onDragOverEntry: (event: ReactDragEvent<HTMLElement>, folderId: string, orderKey: string) => void
  onDropByEntry: (event: ReactDragEvent<HTMLElement>, folderId: string, orderKey: string) => void
  onActivateSession: (sessionId: string) => void
  onCloseSession: (session: RuntimeSession) => void
  onResumeConversation: (session: HistorySession) => void
  onRemoveHistory: (historyKey: string) => void
  onNewFolderNameChange: (name: string) => void
  onAddFolder: () => void
  onCancelNewFolder: () => void
  onRenameFolder: (folderId: string, name: string) => void
  onRemoveFolder: (folderId: string) => void
  onBeginResize: (event: ReactPointerEvent<HTMLDivElement>) => void
  onResetHeight: () => void
  onResizeWithKeyboard: (event: ReactKeyboardEvent<HTMLDivElement>) => void
}

const EMPTY_FOLDER_VIEW: FolderView = { entries: [], sessionCount: 0, historyCount: 0 }

export function SidebarFoldersSection({
  open,
  recentOpen,
  folders,
  folderViews,
  selectedFolderId,
  newFolderName,
  draggedItem,
  dragOverFolderId,
  dropIndicator,
  removingEntry,
  activeSessionId,
  profilesById,
  notificationsBySessionId,
  folderPaneHeight,
  folderPaneHeightRange,
  folderTreeRef,
  folderSessionRefs,
  resolvedAgentIcon,
  onToggle,
  onNewFolder,
  onNewSession,
  onToggleFolder,
  onToggleFolderLock,
  onCollapseAll,
  onFolderDragEnter,
  onFolderDragLeave,
  onFolderDragOver,
  onDropIntoFolder,
  onStartItemDrag,
  onFinishItemDrag,
  onDragOverEntry,
  onDropByEntry,
  onActivateSession,
  onCloseSession,
  onResumeConversation,
  onRemoveHistory,
  onNewFolderNameChange,
  onAddFolder,
  onCancelNewFolder,
  onRenameFolder,
  onRemoveFolder,
  onBeginResize,
  onResetHeight,
  onResizeWithKeyboard,
}: SidebarFoldersSectionProps) {
  const [renamingFolderId, setRenamingFolderId] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const [confirmingFolderId, setConfirmingFolderId] = useState('')
  const [confirmingCloseId, setConfirmingCloseId] = useState('')
  const [folderMenu, setFolderMenu] = useState<{ folderId: string; left: number; top: number } | null>(null)
  const confirmTimer = useRef<number>()
  useEffect(() => () => window.clearTimeout(confirmTimer.current), [])
  useEffect(() => {
    if (!folderMenu) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFolderMenu(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [folderMenu])

  const FOLDER_MENU_WIDTH = 186
  const openFolderMenu = (event: ReactMouseEvent<HTMLButtonElement>, folderId: string): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    const left = Math.max(8, Math.min(window.innerWidth - FOLDER_MENU_WIDTH - 8, rect.right - FOLDER_MENU_WIDTH))
    const top = Math.min(window.innerHeight - 128, rect.bottom + 4)
    setFolderMenu((current) => current?.folderId === folderId ? null : { folderId, left, top })
  }

  const beginRename = (folder: LogicalFolder): void => {
    setRenamingFolderId(folder.id)
    setRenameDraft(folder.name)
  }
  const commitRename = (): void => {
    if (renamingFolderId) onRenameFolder(renamingFolderId, renameDraft)
    setRenamingFolderId('')
  }
  const requestRemoveFolder = (folderId: string, entryCount: number): void => {
    window.clearTimeout(confirmTimer.current)
    // Deleting a folder with contents moves them to Unsorted; ask for a
    // second click so a stray hover-click cannot scatter a curated folder.
    if (entryCount > 0 && confirmingFolderId !== folderId) {
      setConfirmingFolderId(folderId)
      confirmTimer.current = window.setTimeout(() => setConfirmingFolderId(''), 2600)
      return
    }
    setConfirmingFolderId('')
    onRemoveFolder(folderId)
  }
  const requestCloseSession = (session: RuntimeSession): void => {
    window.clearTimeout(confirmTimer.current)
    if (session.state === 'processing' && confirmingCloseId !== session.id) {
      setConfirmingCloseId(session.id)
      confirmTimer.current = window.setTimeout(() => setConfirmingCloseId(''), 2600)
      return
    }
    setConfirmingCloseId('')
    onCloseSession(session)
  }

  return (
    <>
      <SectionHeading
        label="Folders"
        count={folders.length}
        open={open}
        onToggle={onToggle}
        actions={(
          <span className="heading-actions">
            <button className="mini-icon-button" title={selectedFolderId ? 'Collapse open folder' : 'Reopen last folder'} onClick={onCollapseAll}>
              {selectedFolderId ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
            </button>
            <button className="mini-icon-button" title="New folder" onClick={onNewFolder}><FolderPlus size={13} /></button>
            <button className="mini-icon-button" title="New session" onClick={onNewSession}><Plus size={15} strokeWidth={2.4} /></button>
          </span>
        )}
      />
      {open && (
        <nav className={recentOpen ? 'folder-tree' : 'folder-tree fill'} ref={folderTreeRef} aria-label="Folders" style={recentOpen ? { height: folderPaneHeight + 'px' } : undefined}>
          {folders.map((folder) => {
            const folderView = folderViews.get(folder.id) ?? EMPTY_FOLDER_VIEW
            const folderEntryCount = folderView.sessionCount + folderView.historyCount
            return (
              <div
                className={`folder-node ${dragOverFolderId === folder.id ? 'drop-target' : ''}`}
                key={folder.id}
                onDragEnter={() => {
                  if (draggedItem) onFolderDragEnter(folder.id)
                }}
                onDragLeave={(event) => {
                  const nextTarget = event.relatedTarget as Node | null
                  if (!nextTarget || !event.currentTarget.contains(nextTarget)) onFolderDragLeave()
                }}
                onDragOver={(event) => onFolderDragOver(event, folder.id)}
                onDrop={(event) => onDropIntoFolder(event, folder.id)}
              >
                {renamingFolderId === folder.id ? (
                  <div className="new-folder-row folder-rename-row">
                    <Folder size={15} />
                    <input
                      autoFocus
                      aria-label="Rename folder"
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename()
                        if (event.key === 'Escape') setRenamingFolderId('')
                      }}
                    />
                  </div>
                ) : (
                  <div className={`tree-row-shell ${confirmingFolderId === folder.id ? 'confirming-remove' : ''}`}>
                    <button
                      className={`tree-row ${selectedFolderId === folder.id ? 'active' : ''}`}
                      aria-expanded={selectedFolderId === folder.id}
                      onClick={() => onToggleFolder(folder.id)}
                      onDoubleClick={() => beginRename(folder)}
                    >
                      {selectedFolderId === folder.id ? <FolderOpen size={15} /> : folder.locked ? <FolderLock size={15} /> : <Folder size={15} />}
                      <span>{folder.name}</span>
                      {folderEntryCount > 0 && <small className="folder-count">{folderEntryCount}</small>}
                    </button>
                    <span className="tree-row-actions">
                      <button
                        className="mini-icon-button"
                        title="Folder menu"
                        aria-haspopup="menu"
                        aria-expanded={folderMenu?.folderId === folder.id}
                        onClick={(event) => openFolderMenu(event, folder.id)}
                      >
                        <EllipsisVertical size={13} />
                      </button>
                    </span>
                  </div>
                )}
                <div className={`folder-contents ${selectedFolderId === folder.id ? 'open' : ''}`}>
                  <div className="folder-contents-inner">
                    {folderView.entries.map((entry) => {
                      const dropClass = dropIndicator?.folderId === folder.id && dropIndicator.orderKey === entry.orderKey
                        ? `drop-${dropIndicator.edge}`
                        : ''
                      if (entry.kind === 'session') {
                        const { session } = entry
                        const profile = profilesById.get(session.agentId)
                        const sessionNotification = notificationsBySessionId.get(session.id)
                        return (
                          <div
                            className={`session-row folder-entry ${activeSessionId === session.id ? 'active' : ''} ${draggedItem?.kind === 'session' && draggedItem.key === session.id ? 'dragging' : ''} ${removingEntry === `session:${session.id}` ? 'removing' : ''} ${dropClass}`}
                            draggable
                            key={entry.orderKey}
                            ref={(element) => {
                              if (element) folderSessionRefs.current.set(session.id, element)
                              else folderSessionRefs.current.delete(session.id)
                            }}
                            onDragStart={(event) => onStartItemDrag(event, { kind: 'session', key: session.id })}
                            onDragEnd={onFinishItemDrag}
                            onDragOver={(event) => onDragOverEntry(event, folder.id, entry.orderKey)}
                            onDrop={(event) => onDropByEntry(event, folder.id, entry.orderKey)}
                          >
                            <button className="session-select" onClick={() => onActivateSession(session.id)}>
                              <AgentAvatar agentId={session.agentId} className="tinted" color={profile?.color ?? '#7e878d'} preference={resolvedAgentIcon(session.agentId)} />
                              <span className="session-copy">
                                <span className="session-title-line">
                                  <strong title={session.title}>{session.title}</strong>
                                  {sessionNotification && (
                                    <span className={`session-notification-marker ${sessionNotification.type}`} title={notificationTypeLabel(sessionNotification)}>
                                      <NotificationTypeIcon notification={sessionNotification} size={11} />
                                    </span>
                                  )}
                                  <span className={`state-dot ${session.state}`} />
                                </span>
                                <small>{session.cwd}</small>
                              </span>
                            </button>
                            <button
                              className={`session-close ${confirmingCloseId === session.id ? 'confirming' : ''}`}
                              title={confirmingCloseId === session.id
                                ? 'Session is still working — click again to close'
                                : 'Remove from folder and close session'}
                              draggable={false}
                              onClick={() => requestCloseSession(session)}
                            ><X size={13} /></button>
                          </div>
                        )
                      }

                      const { historySession } = entry
                      const profile = profilesById.get(historySession.agentId)
                      return (
                        <div
                          className={`session-row folder-entry history-entry ${draggedItem?.kind === 'history' && draggedItem.key === historySession.key ? 'dragging' : ''} ${removingEntry === `history:${historySession.key}` ? 'removing' : ''} ${dropClass}`}
                          draggable
                          key={entry.orderKey}
                          onDragStart={(event) => onStartItemDrag(event, { kind: 'history', key: historySession.key })}
                          onDragEnd={onFinishItemDrag}
                          onDragOver={(event) => onDragOverEntry(event, folder.id, entry.orderKey)}
                          onDrop={(event) => onDropByEntry(event, folder.id, entry.orderKey)}
                        >
                          <button className="session-select" onClick={() => onResumeConversation(historySession)}>
                            <AgentAvatar agentId={historySession.agentId} className="tinted" color={profile?.color ?? '#7e878d'} preference={resolvedAgentIcon(historySession.agentId)} />
                            <span className="session-copy">
                              <strong title={historySession.title}>{historySession.title}</strong>
                              <small>{historySession.agentId} · {new Date(historySession.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>
                            </span>
                          </button>
                          <button className="session-close" title="Remove from folder" draggable={false} onClick={() => onRemoveHistory(historySession.key)}><X size={13} /></button>
                        </div>
                      )
                    })}
                    {!folderEntryCount && <p className="folder-empty">No conversations</p>}
                  </div>
                </div>
              </div>
            )
          })}
          {newFolderName !== null && (
            <div className="new-folder-row">
              <Folder size={15} />
              <input
                autoFocus
                aria-label="Folder name"
                value={newFolderName}
                onChange={(event) => onNewFolderNameChange(event.target.value)}
                onBlur={onAddFolder}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onAddFolder()
                  if (event.key === 'Escape') onCancelNewFolder()
                }}
              />
            </div>
          )}
        </nav>
      )}
      {folderMenu && (() => {
        const menuFolder = folders.find((folder) => folder.id === folderMenu.folderId)
        if (!menuFolder) return null
        const menuView = folderViews.get(menuFolder.id) ?? EMPTY_FOLDER_VIEW
        const menuEntryCount = menuView.sessionCount + menuView.historyCount
        return createPortal(
          <>
            <button className="folder-menu-backdrop" aria-label="Close folder menu" onClick={() => setFolderMenu(null)} />
            <div className="folder-menu" role="menu" style={{ left: folderMenu.left, top: folderMenu.top }}>
              <button
                className="folder-menu-item"
                role="menuitem"
                onClick={() => {
                  onToggleFolderLock(menuFolder.id)
                  setFolderMenu(null)
                }}
              >
                {menuFolder.locked ? <LockOpen size={12} /> : <Lock size={12} />}
                {menuFolder.locked ? 'Unlock' : 'Lock (keep collapsed)'}
              </button>
              <button
                className="folder-menu-item"
                role="menuitem"
                onClick={() => {
                  beginRename(menuFolder)
                  setFolderMenu(null)
                }}
              >
                <Pencil size={12} />Rename
              </button>
              {menuFolder.id !== 'unsorted' && (
                <button
                  className={`folder-menu-item danger ${confirmingFolderId === menuFolder.id ? 'confirming' : ''}`}
                  role="menuitem"
                  onClick={() => {
                    const armed = confirmingFolderId === menuFolder.id
                    requestRemoveFolder(menuFolder.id, menuEntryCount)
                    if (armed || menuEntryCount === 0) setFolderMenu(null)
                  }}
                >
                  <Trash2 size={12} />
                  {confirmingFolderId === menuFolder.id ? 'Click again to delete' : 'Delete folder'}
                </button>
              )}
            </div>
          </>,
          document.body,
        )
      })()}
      {open && recentOpen && (
        <div
          className="folder-pane-resizer"
          role="separator"
          aria-label="Resize Folders and Recent"
          aria-orientation="horizontal"
          aria-valuemin={folderPaneHeightRange[0]}
          aria-valuemax={folderPaneHeightRange[1]}
          aria-valuenow={Math.round(folderPaneHeight)}
          tabIndex={0}
          onPointerDown={onBeginResize}
          onDoubleClick={onResetHeight}
          onKeyDown={onResizeWithKeyboard}
        />
      )}
    </>
  )
}

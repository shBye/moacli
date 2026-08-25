import type {
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
} from 'react'
import { Search } from 'lucide-react'
import type { AgentHealth, AppNotification, HistorySession } from '../../../electron/contracts'
import type { AgentIconPreference } from '../agent-icons/types'
import type { FolderView, LogicalFolder } from '../folders/types'
import type { RuntimeSession } from '../sessions/types'
import { SidebarAgentsSection } from './SidebarAgentsSection'
import { SidebarFoldersSection } from './SidebarFoldersSection'
import { SidebarRecentSection } from './SidebarRecentSection'
import type {
  DraggedSidebarItem,
  FolderDropIndicator,
  SidebarSectionKey,
  SidebarSectionState,
} from './types'

interface AppSidebarProps {
  collapsed: boolean
  sections: SidebarSectionState
  folders: LogicalFolder[]
  folderViews: Map<string, FolderView>
  selectedFolderId: string
  newFolderName: string | null
  draggedItem: DraggedSidebarItem | null
  dragOverFolderId: string
  dropIndicator: FolderDropIndicator | null
  removingEntry: string
  activeSessionId: string
  activeHistoryKey: string
  filteredHistory: HistorySession[]
  folderAssignments: Record<string, string>
  profiles: AgentHealth[]
  profilesById: Map<string, AgentHealth>
  profilesRefreshing: boolean
  notificationsBySessionId: Map<string, AppNotification>
  sidebarWidth: number
  folderPaneHeight: number
  sidebarWidthRange: readonly [number, number]
  folderPaneHeightRange: readonly [number, number]
  folderTreeRef: Ref<HTMLElement>
  folderSessionRefs: { current: Map<string, HTMLDivElement> }
  resolvedAgentIcon: (agentId: string) => AgentIconPreference
  onOpenSearch: () => void
  onToggleSection: (section: SidebarSectionKey) => void
  onNewFolder: () => void
  onNewSession: () => void
  onToggleFolder: (folderId: string) => void
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
  onRefreshHistory: () => void
  onRefreshProfiles: () => void
  onBeginFolderPaneResize: (event: ReactPointerEvent<HTMLDivElement>) => void
  onResetFolderPaneHeight: () => void
  onResizeFolderPaneWithKeyboard: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  onBeginSidebarResize: (event: ReactPointerEvent<HTMLDivElement>) => void
  onResetSidebarWidth: () => void
  onResizeSidebarWithKeyboard: (event: ReactKeyboardEvent<HTMLDivElement>) => void
}

export function AppSidebar({
  collapsed,
  sections,
  folders,
  folderViews,
  selectedFolderId,
  newFolderName,
  draggedItem,
  dragOverFolderId,
  dropIndicator,
  removingEntry,
  activeSessionId,
  activeHistoryKey,
  filteredHistory,
  folderAssignments,
  profiles,
  profilesById,
  profilesRefreshing,
  notificationsBySessionId,
  sidebarWidth,
  folderPaneHeight,
  sidebarWidthRange,
  folderPaneHeightRange,
  folderTreeRef,
  folderSessionRefs,
  resolvedAgentIcon,
  onOpenSearch,
  onToggleSection,
  onNewFolder,
  onNewSession,
  onToggleFolder,
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
  onRefreshHistory,
  onRefreshProfiles,
  onBeginFolderPaneResize,
  onResetFolderPaneHeight,
  onResizeFolderPaneWithKeyboard,
  onBeginSidebarResize,
  onResetSidebarWidth,
  onResizeSidebarWithKeyboard,
}: AppSidebarProps) {
  return (
    <aside className="sidebar scroll" id="app-sidebar" aria-hidden={collapsed}>
      <button className="search-box search-trigger" aria-label="Open conversation search" onClick={onOpenSearch}>
        <Search size={14} aria-hidden="true" />
        <span>Search conversations</span>
        <kbd>Ctrl K</kbd>
      </button>

      <SidebarFoldersSection
        open={sections.folders}
        recentOpen={sections.recent}
        folders={folders}
        folderViews={folderViews}
        selectedFolderId={selectedFolderId}
        newFolderName={newFolderName}
        draggedItem={draggedItem}
        dragOverFolderId={dragOverFolderId}
        dropIndicator={dropIndicator}
        removingEntry={removingEntry}
        activeSessionId={activeSessionId}
        profilesById={profilesById}
        notificationsBySessionId={notificationsBySessionId}
        folderPaneHeight={folderPaneHeight}
        folderPaneHeightRange={folderPaneHeightRange}
        folderTreeRef={folderTreeRef}
        folderSessionRefs={folderSessionRefs}
        resolvedAgentIcon={resolvedAgentIcon}
        onToggle={() => onToggleSection('folders')}
        onNewFolder={onNewFolder}
        onNewSession={onNewSession}
        onToggleFolder={onToggleFolder}
        onFolderDragEnter={onFolderDragEnter}
        onFolderDragLeave={onFolderDragLeave}
        onFolderDragOver={onFolderDragOver}
        onDropIntoFolder={onDropIntoFolder}
        onStartItemDrag={onStartItemDrag}
        onFinishItemDrag={onFinishItemDrag}
        onDragOverEntry={onDragOverEntry}
        onDropByEntry={onDropByEntry}
        onActivateSession={onActivateSession}
        onCloseSession={onCloseSession}
        onResumeConversation={onResumeConversation}
        onRemoveHistory={onRemoveHistory}
        onNewFolderNameChange={onNewFolderNameChange}
        onAddFolder={onAddFolder}
        onCancelNewFolder={onCancelNewFolder}
        onBeginResize={onBeginFolderPaneResize}
        onResetHeight={onResetFolderPaneHeight}
        onResizeWithKeyboard={onResizeFolderPaneWithKeyboard}
      />
      <SidebarRecentSection
        open={sections.recent}
        history={filteredHistory}
        activeHistoryKey={activeHistoryKey}
        draggedItem={draggedItem}
        folderAssignments={folderAssignments}
        folders={folders}
        resolvedAgentIcon={resolvedAgentIcon}
        onToggle={() => onToggleSection('recent')}
        onRefresh={onRefreshHistory}
        onResume={onResumeConversation}
        onStartDrag={onStartItemDrag}
        onFinishDrag={onFinishItemDrag}
      />
      <SidebarAgentsSection
        open={sections.agents}
        profiles={profiles}
        refreshing={profilesRefreshing}
        resolvedAgentIcon={resolvedAgentIcon}
        onToggle={() => onToggleSection('agents')}
        onRefresh={onRefreshProfiles}
      />
      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemin={sidebarWidthRange[0]}
        aria-valuemax={sidebarWidthRange[1]}
        aria-valuenow={Math.round(sidebarWidth)}
        tabIndex={0}
        onPointerDown={onBeginSidebarResize}
        onDoubleClick={onResetSidebarWidth}
        onKeyDown={onResizeSidebarWithKeyboard}
      />
    </aside>
  )
}

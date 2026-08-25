export type SidebarSectionKey = 'folders' | 'recent' | 'agents'

export interface SidebarSectionState {
  folders: boolean
  recent: boolean
  agents: boolean
}

export interface DraggedSidebarItem {
  kind: 'history' | 'session'
  key: string
}

export interface FolderDropIndicator {
  folderId: string
  orderKey: string
  edge: 'before' | 'after'
}

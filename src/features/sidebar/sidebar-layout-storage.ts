import {
  DEFAULT_FOLDER_PANE_HEIGHT,
  DEFAULT_SIDEBAR_WIDTH,
  clampFolderPaneHeight,
  clampSidebarWidth,
} from './sidebar-layout-policy'

export interface SidebarLayoutStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export interface StoredSidebarLayout {
  width: number
  collapsed: boolean
  folderPaneHeight: number
}

const SIDEBAR_WIDTH_STORAGE_KEY = 'cli-agent-manager.sidebar-width'
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'cli-agent-manager.sidebar-collapsed'
const FOLDER_PANE_HEIGHT_STORAGE_KEY = 'cli-agent-manager.folder-pane-height'

function readNumber(storage: SidebarLayoutStorage, key: string, fallback: number): number {
  const value = Number(storage.getItem(key))
  return Number.isFinite(value) ? value : fallback
}

export function readSidebarLayout(storage: SidebarLayoutStorage, viewportHeight: number): StoredSidebarLayout {
  return {
    width: clampSidebarWidth(readNumber(storage, SIDEBAR_WIDTH_STORAGE_KEY, DEFAULT_SIDEBAR_WIDTH)),
    collapsed: storage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true',
    folderPaneHeight: clampFolderPaneHeight(
      readNumber(storage, FOLDER_PANE_HEIGHT_STORAGE_KEY, DEFAULT_FOLDER_PANE_HEIGHT),
      viewportHeight,
    ),
  }
}

export function saveSidebarWidth(storage: SidebarLayoutStorage, width: number): void {
  storage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width))
}

export function saveSidebarCollapsed(storage: SidebarLayoutStorage, collapsed: boolean): void {
  storage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed))
}

export function saveFolderPaneHeight(storage: SidebarLayoutStorage, height: number): void {
  storage.setItem(FOLDER_PANE_HEIGHT_STORAGE_KEY, String(height))
}

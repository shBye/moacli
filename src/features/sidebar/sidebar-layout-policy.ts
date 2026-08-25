export const DEFAULT_SIDEBAR_WIDTH = 288
export const MIN_SIDEBAR_WIDTH = 200
export const MAX_SIDEBAR_WIDTH = 420
export const DEFAULT_FOLDER_PANE_HEIGHT = 260
export const MIN_FOLDER_PANE_HEIGHT = 80
export const MAX_FOLDER_PANE_HEIGHT = 520

export const SIDEBAR_WIDTH_RANGE = [MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH] as const
export const FOLDER_PANE_HEIGHT_RANGE = [MIN_FOLDER_PANE_HEIGHT, MAX_FOLDER_PANE_HEIGHT] as const

export function clampSidebarWidth(value: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value))
}

export function maximumFolderPaneHeight(viewportHeight: number): number {
  return Math.max(MIN_FOLDER_PANE_HEIGHT, Math.min(MAX_FOLDER_PANE_HEIGHT, viewportHeight - 260))
}

export function clampFolderPaneHeight(value: number, viewportHeight: number): number {
  return Math.min(maximumFolderPaneHeight(viewportHeight), Math.max(MIN_FOLDER_PANE_HEIGHT, value))
}

export function sidebarWidthForKey(key: string, current: number): number | null {
  if (key === 'ArrowLeft') return clampSidebarWidth(current - 12)
  if (key === 'ArrowRight') return clampSidebarWidth(current + 12)
  if (key === 'Home') return DEFAULT_SIDEBAR_WIDTH
  return null
}

export function folderPaneHeightForKey(key: string, current: number, viewportHeight: number): number | null {
  if (key === 'ArrowUp') return clampFolderPaneHeight(current - 16, viewportHeight)
  if (key === 'ArrowDown') return clampFolderPaneHeight(current + 16, viewportHeight)
  if (key === 'Home') return clampFolderPaneHeight(DEFAULT_FOLDER_PANE_HEIGHT, viewportHeight)
  return null
}

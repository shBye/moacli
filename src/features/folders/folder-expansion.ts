import type { LogicalFolder } from './types'

export interface FolderExpansion {
  open: readonly string[]
  previous: readonly string[]
}

export function availableOpenFolders(ids: readonly string[], folders: readonly LogicalFolder[]): string[] {
  return ids.filter((id) => folders.some((folder) => folder.id === id && !folder.locked))
}

export function changeFolderExpansion(state: FolderExpansion, folders: readonly LogicalFolder[], id: string, action: 'open' | 'toggle' | 'close'): FolderExpansion {
  const open = availableOpenFolders(state.open, folders)
  const allowed = folders.some((folder) => folder.id === id && !folder.locked)
  const close = action === 'close' || (action === 'toggle' && open.includes(id))
  const next = close ? open.filter((item) => item !== id) : allowed && !open.includes(id) ? [...open, id] : open
  return { ...state, open: next }
}

export function toggleAllFolders(state: FolderExpansion, folders: readonly LogicalFolder[]): FolderExpansion {
  const open = availableOpenFolders(state.open, folders)
  if (open.length) return { open: [], previous: open }
  const previous = availableOpenFolders(state.previous, folders)
  const fallback = folders.find((folder) => !folder.locked)
  return { ...state, open: previous.length ? previous : fallback ? [fallback.id] : [] }
}

export function folderRevealScrollDelta(top: number, bottom: number, viewportTop: number, viewportBottom: number): number {
  if (top < viewportTop && bottom > viewportBottom) return 0
  if (top < viewportTop) return top - viewportTop
  if (bottom > viewportBottom) return bottom - viewportBottom
  return 0
}

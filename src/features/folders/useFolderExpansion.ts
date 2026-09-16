import { useState } from 'react'
import type { LogicalFolder } from './types'
import { availableOpenFolders, changeFolderExpansion, toggleAllFolders, type FolderExpansion } from './folder-expansion'

export function useFolderExpansion(folders: readonly LogicalFolder[]) {
  const [state, setState] = useState<FolderExpansion>({ open: ['prototype'], previous: [] })
  const change = (id: string, action: 'open' | 'toggle' | 'close') => {
    setState((current) => changeFolderExpansion(current, folders, id, action))
  }
  return {
    openFolderIds: availableOpenFolders(state.open, folders),
    expandFolder: (id: string) => change(id, 'open'),
    toggleFolder: (id: string) => change(id, 'toggle'),
    collapseFolder: (id: string) => change(id, 'close'),
    toggleAllFolders: () => setState((current) => toggleAllFolders(current, folders)),
  }
}

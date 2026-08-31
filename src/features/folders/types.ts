import type { HistorySession } from '../../../electron/contracts'
import type { RuntimeSession } from '../sessions/types'

export interface LogicalFolder {
  id: string
  name: string
  // A locked folder stays collapsed: clicks and session reveals do not expand it.
  locked?: boolean
}

export type FolderEntryView =
  | { kind: 'session'; orderKey: string; session: RuntimeSession }
  | { kind: 'history'; orderKey: string; historySession: HistorySession }

export interface FolderView {
  entries: FolderEntryView[]
  sessionCount: number
  historyCount: number
}

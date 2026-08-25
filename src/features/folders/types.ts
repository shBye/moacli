import type { HistorySession } from '../../../electron/contracts'
import type { RuntimeSession } from '../sessions/types'

export interface LogicalFolder {
  id: string
  name: string
}

export type FolderEntryView =
  | { kind: 'session'; orderKey: string; session: RuntimeSession }
  | { kind: 'history'; orderKey: string; historySession: HistorySession }

export interface FolderView {
  entries: FolderEntryView[]
  sessionCount: number
  historyCount: number
}

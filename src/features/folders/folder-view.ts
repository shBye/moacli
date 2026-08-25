import type { HistorySession } from '../../../electron/contracts'
import type { RuntimeSession } from '../sessions/types'
import type { FolderEntryView, FolderView, LogicalFolder } from './types'

export interface BuildFolderViewsInput {
  folders: readonly LogicalFolder[]
  sessions: readonly RuntimeSession[]
  history: readonly HistorySession[]
  assignments: Readonly<Record<string, string>>
  orders: Readonly<Record<string, string[]>>
}

export function buildFolderViews({
  folders,
  sessions,
  history,
  assignments,
  orders,
}: BuildFolderViewsInput): Map<string, FolderView> {
  const sessionsByFolder = new Map<string, RuntimeSession[]>()
  const historyKeysByFolder = new Map<string, Set<string>>()

  for (const session of sessions) {
    const folderId = session.folderId || 'unsorted'
    const groupedSessions = sessionsByFolder.get(folderId) ?? []
    groupedSessions.push(session)
    sessionsByFolder.set(folderId, groupedSessions)
    if (session.historyKey) {
      const keys = historyKeysByFolder.get(folderId) ?? new Set<string>()
      keys.add(session.historyKey)
      historyKeysByFolder.set(folderId, keys)
    }
  }

  const assignedHistoryByFolder = new Map<string, HistorySession[]>()
  for (const historySession of history) {
    const folderId = assignments[historySession.key]
    if (!folderId || historyKeysByFolder.get(folderId)?.has(historySession.key)) continue
    const groupedHistory = assignedHistoryByFolder.get(folderId) ?? []
    groupedHistory.push(historySession)
    assignedHistoryByFolder.set(folderId, groupedHistory)
  }

  return new Map(folders.map((folder) => {
    const folderSessions = sessionsByFolder.get(folder.id) ?? []
    const assignedHistory = assignedHistoryByFolder.get(folder.id) ?? []
    const folderOrder = new Map((orders[folder.id] ?? []).map((key, index) => [key, index]))
    const entries: FolderEntryView[] = [
      ...folderSessions.map((session) => ({
        kind: 'session' as const,
        orderKey: session.historyKey ? `history:${session.historyKey}` : `session:${session.id}`,
        session,
      })),
      ...assignedHistory.map((historySession) => ({
        kind: 'history' as const,
        orderKey: `history:${historySession.key}`,
        historySession,
      })),
    ]
    entries.sort((left, right) => (
      (folderOrder.get(left.orderKey) ?? Number.MAX_SAFE_INTEGER)
      - (folderOrder.get(right.orderKey) ?? Number.MAX_SAFE_INTEGER)
    ))
    return [folder.id, {
      entries,
      sessionCount: folderSessions.length,
      historyCount: assignedHistory.length,
    }]
  }))
}

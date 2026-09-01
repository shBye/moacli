import type { SearchIndexState } from './contracts'

// RPC surface of the history host utility process. Method names mirror the
// public, serializable part of SessionHistoryService.
export type HistoryHostMethodName =
  | 'detectAccounts'
  | 'inspectAccount'
  | 'list'
  | 'get'
  | 'searchConversations'
  | 'getSearchIndexState'
  | 'rebuildSearchIndex'

export type MainToHistoryHostMessage =
  | { type: 'configure'; searchDatabasePath: string }
  | { type: 'worker-sessions'; ids: string[] }
  | { type: 'call'; requestId: number; method: HistoryHostMethodName; args: unknown[] }
  | { type: 'shutdown' }

export type HistoryHostToMainMessage =
  | { type: 'ready' }
  | { type: 'result'; requestId: number; value?: unknown; error?: string }
  | { type: 'search-state'; state: SearchIndexState }

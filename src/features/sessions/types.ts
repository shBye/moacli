import type { AgentAccount, ConversationHistory } from '../../../electron/contracts'

export type SessionState = 'idle' | 'starting' | 'running' | 'processing' | 'needs_attention' | 'stopped'
export type SessionView = 'cli' | 'conversation' | 'review'

export interface RuntimeSession {
  id: string
  agentId: string
  cwd: string
  title: string
  customTitle?: string
  account?: AgentAccount
  purpose: 'session' | 'login'
  resumeId: string
  folderId: string
  historyKey: string
  historyKeysAtStart: string[]
  conversation: ConversationHistory | null
  conversationLoading: boolean
  conversationLoadingOlder: boolean
  conversationError: string
  terminalEnabled: boolean
  terminalRevision: number
  highlightMessageId: string
  state: SessionState
  statusDetail: string
  view: SessionView
  createdAt: number
  lastViewedAt: number
  lastActivityAt: number
  revealLatestAt: number
  pendingPaste?: { id: string; text: string }
}

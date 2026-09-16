import type { TerminalDiagnosticEvent } from '../src/shared/terminal-diagnostics'
import type { AgentEvent } from '../src/features/sessions/agent-event'

export interface AgentProfile {
  id: string
  label: string
  color: string
  bin: string
  args_new: string[]
  args_name?: string[]
  args_login?: string[]
  args_resume: string[]
  version_cmd: string[]
  env: Record<string, string>
  attention_adapter?: 'claude-http' | 'codex-osc9'
  attention_min_version?: string
}

export type AttentionSupportStatus = 'supported' | 'update_required' | 'version_unknown' | 'not_integrated'

export interface AgentAttentionSupport {
  status: AttentionSupportStatus
  minimumVersion: string | null
}

export interface AgentHealth extends AgentProfile {
  available: boolean
  resolvedPath: string | null
  version: string | null
  attention: AgentAttentionSupport
}

export interface StartPtyRequest {
  historyKey?: string
  id: string
  sessionId: string
  agentId: string
  cwd: string
  title?: string
  account?: AgentAccount
  purpose?: 'session' | 'login'
  resumeId?: string
  cols: number
  rows: number
}

export interface AgentAccount {
  id: string
  agentId: string
  email: string
  configDir: string
  detected?: boolean
}

export interface PtyDataEvent {
  id: string
  data: string
}

export interface PtyExitEvent {
  id: string
  exitCode: number
}

export interface PtyAttentionEvent {
  id: string
  event: AgentEvent
}

export type AppNotificationType = 'needs_attention' | 'approval_required' | 'input_required' | 'completed' | 'failed' | 'account_changed' | 'info'

export interface AppNotification {
  body?: string
  context?: string
  preview?: string
  actionHint?: string
  id: string
  sessionId: string
  agentId: string
  accountId: string
  accountLabel: string
  type: AppNotificationType
  title: string
  createdAt: number
  desktopDeliveredAt?: number
  event?: AgentEvent
}

export interface NotificationSettings {
  desktopPreviewEnabled: boolean
  enabled: boolean
  desktopEnabled: boolean
  needsAttention: boolean
  approvals: boolean
  inputRequired: boolean
  failed: boolean
  completed: boolean
}

export interface NotificationSnapshot {
  version: number
  notifications: AppNotification[]
  settings: NotificationSettings
  mutedSessionIds: string[]
}

export interface NotificationContext {
  activeSessionId: string
  activeView: 'cli' | 'conversation' | 'review' | 'none'
}

export type NotificationActivation =
  | { kind: 'session'; sessionId: string }
  | { kind: 'delegation'; taskId: string }
  | { kind: 'panel' }

export type DelegationTaskStatus = 'awaiting_approval' | 'queued' | 'running' | 'completed' | 'failed' | 'rejected' | 'cancelled'

export interface DelegationTask {
  model?: string
  source?: import('./review-contracts').ReviewSource
  mode?: import('./delegation-policy').DelegationMode
  role?: string
  depth?: number
  id: string
  agent: string
  caller: string
  promptPreview: string
  promptLength: number
  cwd: string
  timeoutMs: number
  status: DelegationTaskStatus
  createdAt: number
  startedAt?: number
  finishedAt?: number
  accountId?: string
  accountEmail?: string
  // Session/thread id the worker CLI recorded its transcript under.
  workerSessionId?: string
  // Id of the failed/cancelled task this one was retried from. Retries are
  // never auto-approved: the point of retrying is picking another account.
  retryOfId?: string
  resultPreview?: string
  error?: string
  detail?: string
  reviewSource?: import('./review-contracts').ReviewSource
}

export interface DelegationServerStatus {
  defaultModels: import('../src/features/delegation/model-policy').DelegationModels
  enabled: boolean
  running: boolean
  // Independent automatic approval for new analysis and edit requests.
  autoApprove: boolean
  autoApproveEdits: boolean
  port: number
  url: string
  token: string
  claudeRegisterCommand: string
  codexConfigSnippet: string
  // Absolute path of the Codex config file the snippet belongs in.
  codexConfigPath: string
}

export interface DelegationSnapshot {
  server: DelegationServerStatus
  tasks: DelegationTask[]
}

export interface DelegationApproval {
  model?: string
  taskId: string
  account?: AgentAccount
}

export interface HistorySession {
  key: string
  agentId: string
  title: string
  cwd: string
  updatedAt: number
  resumeId: string
  messageCount?: number
  accountId: string
  accountEmail: string
}

export interface HistoryMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp?: number
}

export interface ConversationHistory {
  session: HistorySession
  messages: HistoryMessage[]
  // Byte offset to continue loading older messages from; absent once the
  // beginning of the conversation is loaded.
  olderCursor?: number
}

export type SearchIndexPhase = 'idle' | 'indexing' | 'ready' | 'error'

export interface SearchIndexState {
  phase: SearchIndexPhase
  discoveredSources: number
  processedSources: number
  failedSources: number
  indexedSources: number
  indexedMessages: number
  lastUpdatedAt: number
  error: string
}

export interface ConversationSearchResult {
  id: string
  session: HistorySession
  messageId: string
  ordinal: number
  role: 'user' | 'assistant'
  snippet: string
  timestamp?: number
}

export interface ConversationSearchResponse {
  query: string
  results: ConversationSearchResult[]
  index: SearchIndexState
}

export interface TerminalClipboardContent {
  kind: 'text' | 'image' | 'empty'
  value: string
  values?: string[]
}

export interface AppUpdateInfo {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  releaseUrl: string
  installerUrl: string
  publishedAt: string
  checkedAt: number
}

export interface CliAgentApi {
  getTerminalPermissions: () => Promise<import('../src/features/settings/terminal-permissions').TerminalPermissions>
  setCodexPermissionMode: (mode: import('../src/features/settings/terminal-permissions').CodexPermissionMode) => Promise<import('../src/features/settings/terminal-permissions').TerminalPermissions>
  prepareReview: (cwd: string) => Promise<import('./review-contracts').ReviewSnapshot>
  startReview: (request: import('./review-contracts').StartReviewRequest) => Promise<string>
  listReviews: (source: import('./review-contracts').ReviewSource) => Promise<import('./review-contracts').ReviewEntry[]>
  listSessionTasks: (source: import('./review-contracts').ReviewSource) => Promise<DelegationTask[]>
  syncTaskSource: (source: import('./review-contracts').ReviewSource) => Promise<void>
  getSessionTaskResult: (taskId: string) => Promise<string>
  terminalBackend: 'conpty' | 'posix'
  getProfiles: () => Promise<AgentHealth[]>
  detectAccounts: () => Promise<AgentAccount[]>
  inspectAccount: (account: AgentAccount) => Promise<AgentAccount | null>
  selectDirectory: (defaultPath?: string) => Promise<string | null>
  listHistory: (accounts: AgentAccount[]) => Promise<HistorySession[]>
  getConversation: (key: string, before?: number) => Promise<ConversationHistory>
  searchConversations: (query: string) => Promise<ConversationSearchResponse>
  getSearchIndexState: () => Promise<SearchIndexState>
  rebuildSearchIndex: (accounts: AgentAccount[]) => Promise<SearchIndexState>
  onSearchIndexChanged: (callback: (state: SearchIndexState) => void) => () => void
  readTerminalClipboard: () => Promise<TerminalClipboardContent>
  writeTerminalClipboard: (text: string) => void
  startPty: (request: StartPtyRequest) => Promise<void>
  writePty: (id: string, data: string) => void
  resizePty: (id: string, cols: number, rows: number) => void
  stopPty: (id: string) => void
  onPtyData: (id: string, callback: (data: string) => void) => () => void
  onPtyExit: (id: string, callback: (exitCode: number) => void) => () => void
  onPtyAttention: (id: string, callback: (event: AgentEvent) => void) => () => void
  onHistoryChanged: (callback: () => void) => () => void
  getNotificationSnapshot: () => Promise<NotificationSnapshot>
  updateNotificationSettings: (settings: Partial<NotificationSettings>) => Promise<NotificationSnapshot>
  dismissNotification: (id: string) => Promise<NotificationSnapshot>
  clearNotifications: () => Promise<NotificationSnapshot>
  acknowledgeSessionNotification: (sessionId: string) => Promise<NotificationSnapshot>
  setSessionNotificationMuted: (sessionId: string, muted: boolean) => Promise<NotificationSnapshot>
  updateNotificationContext: (context: NotificationContext) => void
  onNotificationsChanged: (callback: (snapshot: NotificationSnapshot) => void) => () => void
  onNotificationActivated: (callback: (activation: NotificationActivation) => void) => () => void
  getDelegationSnapshot: () => Promise<DelegationSnapshot>
  approveDelegation: (approval: DelegationApproval) => Promise<DelegationSnapshot>
  setDelegationModel: (agent: string, model: string) => Promise<DelegationSnapshot>
  getDelegationModel: (agent: string, account?: AgentAccount) => Promise<string>
  rejectDelegation: (taskId: string) => Promise<DelegationSnapshot>
  cancelDelegation: (taskId: string) => Promise<DelegationSnapshot>
  retryDelegation: (taskId: string) => Promise<DelegationSnapshot>
  setDelegationEnabled: (enabled: boolean) => Promise<DelegationSnapshot>
  setDelegationAutoApprove: (enabled: boolean) => Promise<DelegationSnapshot>
  setDelegationAutoApproveEdits: (enabled: boolean) => Promise<DelegationSnapshot>
  regenerateDelegationToken: () => Promise<DelegationSnapshot>
  onDelegationChanged: (callback: (snapshot: DelegationSnapshot) => void) => () => void
  recordTerminalDiagnostics: (events: TerminalDiagnosticEvent[]) => void
  exportTerminalDiagnostics: () => Promise<boolean>
  getAppVersion: () => Promise<string>
  checkForAppUpdate: (force?: boolean) => Promise<AppUpdateInfo>
  downloadAppUpdate: () => Promise<boolean>
  minimizeWindow: () => void
  toggleMaximizeWindow: () => void
  closeWindow: () => void
  isWindowMaximized: () => Promise<boolean>
  onWindowMaximizedChanged: (callback: (maximized: boolean) => void) => () => void
  openExternal: (url: string) => void
}

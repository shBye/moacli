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
}

export interface AgentHealth extends AgentProfile {
  available: boolean
  resolvedPath: string | null
  version: string | null
}

export interface StartPtyRequest {
  id: string
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
}

export interface TerminalClipboardContent {
  kind: 'text' | 'image' | 'empty'
  value: string
  values?: string[]
}

export interface CliAgentApi {
  getProfiles: () => Promise<AgentHealth[]>
  detectAccounts: () => Promise<AgentAccount[]>
  selectDirectory: (defaultPath?: string) => Promise<string | null>
  listHistory: (accounts: AgentAccount[]) => Promise<HistorySession[]>
  getConversation: (key: string) => Promise<ConversationHistory>
  readTerminalClipboard: () => Promise<TerminalClipboardContent>
  startPty: (request: StartPtyRequest) => Promise<void>
  writePty: (id: string, data: string) => void
  resizePty: (id: string, cols: number, rows: number) => void
  stopPty: (id: string) => void
  onPtyData: (id: string, callback: (data: string) => void) => () => void
  onPtyExit: (id: string, callback: (exitCode: number) => void) => () => void
  onHistoryChanged: (callback: () => void) => () => void
  minimizeWindow: () => void
  toggleMaximizeWindow: () => void
  closeWindow: () => void
}

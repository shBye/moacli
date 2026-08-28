import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, openSync, closeSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type {
  AgentAccount,
  ConversationHistory,
  ConversationSearchResponse,
  HistoryMessage,
  HistorySession,
  SearchIndexState,
} from './contracts'
import { detectBinary } from './agent-profiles'
import { ConversationSearchIndex, type SearchIndexSource, type SourceReadProgress } from './conversation-search'

const execFileAsync = promisify(execFile)
const MAX_SESSIONS_PER_AGENT = 30
const SAMPLE_BYTES = 384 * 1024
const JSONL_STREAM_BYTES = 256 * 1024
const SEARCH_SYNC_DELAY_MS = 4000

interface HistorySource {
  agentId: string
  path?: string
  externalId?: string
}

interface SummaryCacheEntry {
  mtimeMs: number
  size: number
  accountEmail: string
  summary: HistorySession | null
}

function keyFor(agentId: string, identity: string): string {
  return createHash('sha256').update(`${agentId}:${identity}`).digest('hex').slice(0, 24)
}

function epoch(value: unknown, fallback: number): number {
  if (typeof value === 'number') return value > 10_000_000_000 ? value : value * 1000
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return fallback
}

function compactTitle(value: unknown, fallback = 'Untitled session'): string {
  if (typeof value !== 'string') return fallback
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact ? compact.slice(0, 100) : fallback
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object') return ''
      const entry = item as Record<string, unknown>
      return typeof entry.text === 'string' ? entry.text : ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function jsonLines(text: string): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      records.push(parsed)
    } catch {
      // A sample may start or end in the middle of a line.
    }
  }
  return records
}

function parseJsonLine(line: Buffer): Record<string, unknown> | null {
  const text = line.toString('utf8').trim()
  if (!text) return null
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch {
    // Ignore an incomplete or malformed record without dropping the rest of the file.
    return null
  }
}

// When `progress` is given the read feeds the search index: only
// newline-terminated records are returned and `progress.safeOffset` tracks the
// byte offset just past the last one, so an incremental pass can resume there
// without duplicating or splitting a record.
function* streamedJsonLines(path: string, fromOffset = 0, progress?: SourceReadProgress): Generator<Record<string, unknown>> {
  const handle = openSync(path, 'r')
  const buffer = Buffer.allocUnsafe(JSONL_STREAM_BYTES)
  let pending: Buffer = Buffer.alloc(0)
  let position = fromOffset
  if (progress) progress.safeOffset = fromOffset
  try {
    let bytesRead = 0
    do {
      bytesRead = readSync(handle, buffer, 0, buffer.length, position)
      position += bytesRead
      if (bytesRead > 0) {
        const chunk = buffer.subarray(0, bytesRead)
        pending = pending.length ? Buffer.concat([pending, chunk]) : Buffer.from(chunk)
      }
      let newline = pending.indexOf(0x0a)
      while (newline >= 0) {
        const line = pending.subarray(0, newline)
        pending = pending.subarray(newline + 1)
        if (progress) progress.safeOffset = position - pending.length
        const record = parseJsonLine(line)
        if (record) yield record
        newline = pending.indexOf(0x0a)
      }
    } while (bytesRead > 0)

    if (!progress && pending.length) {
      // An actively written JSONL file may end with a partial record; show it
      // in the conversation view but never index it.
      const record = parseJsonLine(pending)
      if (record) yield record
    }
  } finally {
    closeSync(handle)
  }
}

function readSample(path: string): string {
  const size = statSync(path).size
  if (size <= SAMPLE_BYTES * 2) return readFileSync(path, 'utf8')
  const handle = openSync(path, 'r')
  try {
    const first = Buffer.alloc(SAMPLE_BYTES)
    const last = Buffer.alloc(SAMPLE_BYTES)
    readSync(handle, first, 0, first.length, 0)
    readSync(handle, last, 0, last.length, size - SAMPLE_BYTES)
    return `${first.toString('utf8')}\n${last.toString('utf8')}`
  } finally {
    closeSync(handle)
  }
}

function recentFiles(paths: string[], extension: string): string[] {
  return paths
    .filter(existsSync)
    .flatMap((directory) => readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map((entry) => join(directory, entry.name)))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, MAX_SESSIONS_PER_AGENT)
}

function claudeFiles(configDir: string): string[] {
  const root = join(configDir, 'projects')
  if (!existsSync(root)) return []
  const projects = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
  return recentFiles(projects, '.jsonl')
}

function codexFiles(configDir: string): string[] {
  const root = join(configDir, 'sessions')
  if (!existsSync(root)) return []
  const files: string[] = []
  const candidateLimit = MAX_SESSIONS_PER_AGENT * 2
  // Rollouts accumulate forever under year/month/day directories with
  // timestamped names. Visiting newest names first and stopping once enough
  // candidates are collected avoids re-walking the whole tree on every refresh.
  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
    for (const entry of entries) {
      if (files.length >= candidateLimit) return
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path)
    }
  }
  visit(root)
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs).slice(0, MAX_SESSIONS_PER_AGENT)
}

function geminiFiles(configDir: string): string[] {
  const root = join(configDir, 'tmp')
  if (!existsSync(root)) return []
  const chats = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name, 'chats'))
  return recentFiles(chats, '.json')
}

async function claudeEmail(configDir: string): Promise<string | undefined> {
  const executable = detectBinary('claude')
  if (!executable) return undefined
  try {
    const isDefault = configDir.toLocaleLowerCase() === join(homedir(), '.claude').toLocaleLowerCase()
    const { stdout } = await execFileAsync(executable, ['auth', 'status'], {
      timeout: 5000,
      windowsHide: true,
      env: isDefault ? process.env : { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    })
    const status = JSON.parse(stdout) as { email?: unknown }
    return typeof status.email === 'string' ? status.email : undefined
  } catch {
    return undefined
  }
}

function geminiEmail(configDir: string): string | undefined {
  const path = join(configDir, 'google_accounts.json')
  if (!existsSync(path)) return undefined
  try {
    const metadata = JSON.parse(readFileSync(path, 'utf8')) as { active?: unknown }
    return typeof metadata.active === 'string' ? metadata.active : undefined
  } catch {
    return undefined
  }
}

function codexEmail(configDir: string): string | undefined {
  const path = join(configDir, 'auth.json')
  if (!existsSync(path)) return undefined
  try {
    const metadata = JSON.parse(readFileSync(path, 'utf8')) as {
      tokens?: { id_token?: unknown }
    }
    const token = metadata.tokens?.id_token
    if (typeof token !== 'string') return undefined
    const payloadPart = token.split('.')[1]
    if (!payloadPart) return undefined
    const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as {
      email?: unknown
      email_verified?: unknown
    }
    return typeof claims.email === 'string' && claims.email_verified !== false ? claims.email : undefined
  } catch {
    return undefined
  }
}

function geminiProjectPaths(configDir: string): Map<string, string> {
  const path = join(configDir, 'projects.json')
  const result = new Map<string, string>()
  if (!existsSync(path)) return result
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as { projects?: Record<string, unknown> }
    for (const [cwd, hash] of Object.entries(data.projects ?? {})) {
      if (typeof hash === 'string') result.set(hash, cwd)
    }
  } catch {
    // Project mapping is optional metadata.
  }
  return result
}

function parseClaudeSummary(path: string, account: AgentAccount): HistorySession | null {
  const records = jsonLines(readSample(path))
  let sessionId = basename(path, '.jsonl')
  let cwd = ''
  let title = ''
  let firstPrompt = ''
  let updatedAt = statSync(path).mtimeMs
  for (const record of records) {
    if (typeof record.sessionId === 'string') sessionId = record.sessionId
    if (typeof record.cwd === 'string') cwd = record.cwd
    if (record.type === 'custom-title' && typeof record.customTitle === 'string') title = record.customTitle
    else if (!title && record.type === 'ai-title' && typeof record.aiTitle === 'string') title = record.aiTitle
    if (!firstPrompt && record.type === 'user') {
      const message = record.message as Record<string, unknown> | undefined
      firstPrompt = contentText(message?.content)
    }
    updatedAt = Math.max(updatedAt, epoch(record.timestamp, 0))
  }
  if (!records.length) return null
  return {
    key: keyFor('claude', `${account.id}:${path}`),
    agentId: 'claude',
    title: compactTitle(title || firstPrompt),
    cwd,
    updatedAt,
    resumeId: sessionId,
    accountId: account.id,
    accountEmail: account.email,
  }
}

function parseCodexSummary(path: string, account: AgentAccount): HistorySession | null {
  const records = jsonLines(readSample(path))
  let sessionId = basename(path, '.jsonl')
  let cwd = ''
  let title = ''
  let updatedAt = statSync(path).mtimeMs
  for (const record of records) {
    const payload = record.payload as Record<string, unknown> | undefined
    if (record.type === 'session_meta' && payload) {
      if (typeof payload.id === 'string') sessionId = payload.id
      if (typeof payload.cwd === 'string') cwd = payload.cwd
    }
    if (!title && record.type === 'response_item' && payload?.type === 'message' && payload.role === 'user') {
      const candidate = contentText(payload.content).trim()
      const synthetic = candidate.startsWith('<environment_context>')
        || candidate.startsWith('<permissions instructions>')
        || candidate.startsWith('# AGENTS.md instructions')
      if (!synthetic) title = candidate
    }
    updatedAt = Math.max(updatedAt, epoch(record.timestamp, 0))
  }
  if (!records.length) return null
  return {
    key: keyFor('codex', `${account.id}:${path}`),
    agentId: 'codex',
    title: compactTitle(title, `Codex ${sessionId.slice(0, 8)}`),
    cwd,
    updatedAt,
    resumeId: sessionId,
    accountId: account.id,
    accountEmail: account.email,
  }
}

function parseGeminiSummary(path: string, projects: Map<string, string>, account: AgentAccount): HistorySession | null {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const messages = Array.isArray(data.messages) ? data.messages as Array<Record<string, unknown>> : []
    const firstUser = messages.find((message) => message.type === 'user')
    const sessionId = typeof data.sessionId === 'string' ? data.sessionId : basename(path, '.json')
    const projectHash = typeof data.projectHash === 'string' ? data.projectHash : ''
    return {
      key: keyFor('gemini', `${account.id}:${path}`),
      agentId: 'gemini',
      title: compactTitle(data.summary || contentText(firstUser?.content), `Gemini ${sessionId.slice(0, 8)}`),
      cwd: projects.get(projectHash) ?? dirname(dirname(path)),
      updatedAt: epoch(data.lastUpdated, statSync(path).mtimeMs),
      resumeId: sessionId,
      messageCount: messages.filter((message) => message.type === 'user' || message.type === 'gemini').length,
      accountId: account.id,
      accountEmail: account.email,
    }
  } catch {
    return null
  }
}

// Records without a native id fall back to their position in the file; an
// incremental read cannot know that position, so it prefixes the offset
// instead of risking a collision with an earlier message.
function fallbackMessageId(fromOffset: number, recordIndex: number): string {
  return fromOffset ? `${fromOffset}+${recordIndex}` : `${recordIndex}`
}

function* iterateClaudeConversation(path: string, fromOffset = 0, progress?: SourceReadProgress): Generator<HistoryMessage> {
  let index = 0
  for (const record of streamedJsonLines(path, fromOffset, progress)) {
    const recordIndex = index
    index += 1
    if (record.type !== 'user' && record.type !== 'assistant') continue
    const message = record.message as Record<string, unknown> | undefined
    const text = contentText(message?.content)
    if (!text) continue
    yield {
      id: typeof record.uuid === 'string' ? record.uuid : fallbackMessageId(fromOffset, recordIndex),
      role: record.type as 'user' | 'assistant',
      text,
      timestamp: epoch(record.timestamp, 0) || undefined,
    }
  }
}

function parseClaudeConversation(path: string): HistoryMessage[] {
  return [...iterateClaudeConversation(path)]
}

function* iterateCodexConversation(path: string, fromOffset = 0, progress?: SourceReadProgress): Generator<HistoryMessage> {
  let index = 0
  for (const record of streamedJsonLines(path, fromOffset, progress)) {
    const recordIndex = index
    index += 1
    if (record.type !== 'response_item') continue
    const payload = record.payload as Record<string, unknown> | undefined
    if (payload?.type !== 'message' || (payload.role !== 'user' && payload.role !== 'assistant')) continue
    const text = contentText(payload.content)
    if (!text) continue
    yield {
      id: typeof payload.id === 'string' ? payload.id : fallbackMessageId(fromOffset, recordIndex),
      role: payload.role,
      text,
      timestamp: epoch(record.timestamp, 0) || undefined,
    }
  }
}

function parseCodexConversation(path: string): HistoryMessage[] {
  return [...iterateCodexConversation(path)]
}

function parseGeminiConversation(path: string): HistoryMessage[] {
  const data = JSON.parse(readFileSync(path, 'utf8')) as { messages?: Array<Record<string, unknown>> }
  return (data.messages ?? []).flatMap((message, index) => {
    if (message.type !== 'user' && message.type !== 'gemini') return []
    const text = contentText(message.content)
    if (!text) return []
    return [{
      id: typeof message.id === 'string' ? message.id : `${index}`,
      role: message.type === 'gemini' ? 'assistant' : 'user',
      text,
      timestamp: epoch(message.timestamp, 0) || undefined,
    }]
  })
}

function openCodeMessages(data: unknown): HistoryMessage[] {
  const root = data as { messages?: Array<Record<string, unknown>> }
  return (root.messages ?? []).flatMap((entry, index) => {
    const info = (entry.info ?? entry) as Record<string, unknown>
    const role = info.role
    if (role !== 'user' && role !== 'assistant') return []
    const parts = Array.isArray(entry.parts) ? entry.parts : []
    const text = contentText(parts)
    if (!text) return []
    const time = info.time as Record<string, unknown> | undefined
    return [{
      id: typeof info.id === 'string' ? info.id : `${index}`,
      role,
      text,
      timestamp: epoch(time?.created, 0) || undefined,
    }]
  })
}

export class SessionHistoryService {
  private sources = new Map<string, HistorySource>()
  private sessions = new Map<string, HistorySession>()
  private readonly summaryCache = new Map<string, SummaryCacheEntry>()
  private searchIndex: ConversationSearchIndex | null = null
  private searchSources: SearchIndexSource[] = []
  private searchSync: Promise<void> = Promise.resolve()
  private pendingSearchSources: SearchIndexSource[] = []
  private searchSyncTimer: ReturnType<typeof setTimeout> | undefined
  private searchState: SearchIndexState = {
    phase: 'idle',
    discoveredSources: 0,
    processedSources: 0,
    failedSources: 0,
    indexedSources: 0,
    indexedMessages: 0,
    lastUpdatedAt: 0,
    error: '',
  }

  initializeSearch(databasePath: string, onStateChanged: (state: SearchIndexState) => void): void {
    this.cancelScheduledSearchSync()
    this.searchIndex?.close()
    try {
      this.searchIndex = new ConversationSearchIndex(databasePath, (state) => {
        this.searchState = state
        onStateChanged(state)
      })
      this.searchState = this.searchIndex.snapshot()
    } catch (error) {
      this.searchIndex = null
      this.searchState = {
        ...this.searchState,
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
      }
      onStateChanged(this.searchState)
    }
  }

  searchConversations(query: string): ConversationSearchResponse {
    if (!this.searchIndex) return { query: query.trim(), results: [], index: this.searchState }
    return this.searchIndex.search(query)
  }

  getSearchIndexState(): SearchIndexState {
    return this.searchIndex?.snapshot() ?? this.searchState
  }

  async rebuildSearchIndex(accounts: AgentAccount[]): Promise<SearchIndexState> {
    if (!this.searchIndex) return this.searchState
    await this.list(accounts)
    this.cancelScheduledSearchSync()
    await this.searchSync
    return this.searchIndex.rebuild(this.searchSources)
  }

  close(): void {
    this.cancelScheduledSearchSync()
    this.searchIndex?.close()
    this.searchIndex = null
  }

  private scheduleSearchSync(sources: SearchIndexSource[]): void {
    this.pendingSearchSources = sources
    clearTimeout(this.searchSyncTimer)
    this.searchSyncTimer = setTimeout(() => {
      this.searchSyncTimer = undefined
      const pending = this.pendingSearchSources
      this.pendingSearchSources = []
      if (!this.searchIndex) return
      this.searchSync = this.searchIndex.synchronize(pending)
    }, SEARCH_SYNC_DELAY_MS)
  }

  private cancelScheduledSearchSync(): void {
    clearTimeout(this.searchSyncTimer)
    this.searchSyncTimer = undefined
    this.pendingSearchSources = []
  }

  async detectAccounts(): Promise<AgentAccount[]> {
    const claudeDir = join(homedir(), '.claude')
    const codexDir = join(homedir(), '.codex')
    const geminiDir = join(homedir(), '.gemini')
    const [detectedClaude, detectedCodex, detectedGemini] = await Promise.all([
      claudeEmail(claudeDir),
      Promise.resolve(codexEmail(codexDir)),
      Promise.resolve(geminiEmail(geminiDir)),
    ])
    const accounts: AgentAccount[] = []
    if (detectedClaude) accounts.push({
      id: keyFor('claude-account', claudeDir),
      agentId: 'claude',
      email: detectedClaude,
      configDir: claudeDir,
      detected: true,
    })
    if (detectedCodex) accounts.push({
      id: keyFor('codex-account', codexDir),
      agentId: 'codex',
      email: detectedCodex,
      configDir: codexDir,
      detected: true,
    })
    if (detectedGemini) accounts.push({
      id: keyFor('gemini-account', geminiDir),
      agentId: 'gemini',
      email: detectedGemini,
      configDir: geminiDir,
      detected: true,
    })
    return accounts
  }

  async inspectAccount(account: AgentAccount): Promise<AgentAccount | null> {
    let email: string | undefined
    if (account.agentId === 'claude') email = await claudeEmail(account.configDir)
    if (account.agentId === 'codex') email = codexEmail(account.configDir)
    if (account.agentId === 'gemini') email = geminiEmail(account.configDir)
    return email ? { ...account, email } : null
  }

  async list(accounts: AgentAccount[]): Promise<HistorySession[]> {
    const validAccounts = accounts.filter((account) => account.id && account.email.trim() && account.configDir && existsSync(account.configDir))
    const local: Array<{ summary: HistorySession | null; source: HistorySource }> = []
    const seenCacheKeys = new Set<string>()
    const cachedSummary = (
      agentId: string,
      path: string,
      account: AgentAccount,
      parse: () => HistorySession | null,
    ): HistorySession | null => {
      const cacheKey = `${agentId}:${account.id}:${path}`
      seenCacheKeys.add(cacheKey)
      try {
        const stats = statSync(path)
        const cached = this.summaryCache.get(cacheKey)
        if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size && cached.accountEmail === account.email) {
          return cached.summary
        }
        const summary = parse()
        this.summaryCache.set(cacheKey, { mtimeMs: stats.mtimeMs, size: stats.size, accountEmail: account.email, summary })
        return summary
      } catch {
        this.summaryCache.delete(cacheKey)
        return null
      }
    }
    for (const account of validAccounts) {
      if (account.agentId === 'claude') {
        local.push(...claudeFiles(account.configDir).map((path) => ({
          summary: cachedSummary('claude', path, account, () => parseClaudeSummary(path, account)),
          source: { agentId: 'claude', path },
        })))
      } else if (account.agentId === 'codex') {
        local.push(...codexFiles(account.configDir).map((path) => ({
          summary: cachedSummary('codex', path, account, () => parseCodexSummary(path, account)),
          source: { agentId: 'codex', path },
        })))
      } else if (account.agentId === 'gemini') {
        const projects = geminiProjectPaths(account.configDir)
        local.push(...geminiFiles(account.configDir).map((path) => ({
          summary: cachedSummary('gemini', path, account, () => parseGeminiSummary(path, projects, account)),
          source: { agentId: 'gemini', path },
        })))
      } else if (account.agentId === 'opencode') {
        local.push(...await this.listOpenCode(account))
      }
    }
    for (const key of this.summaryCache.keys()) {
      if (!seenCacheKeys.has(key)) this.summaryCache.delete(key)
    }
    const nextSessions = new Map<string, HistorySession>()
    const nextSources = new Map<string, HistorySource>()
    for (const item of local) {
      if (!item.summary) continue
      nextSessions.set(item.summary.key, item.summary)
      nextSources.set(item.summary.key, item.source)
    }
    this.sessions = nextSessions
    this.sources = nextSources
    this.searchSources = local.flatMap(({ summary, source }) => {
      if (!summary || !source.path || (source.agentId !== 'claude' && source.agentId !== 'codex')) return []
      return [{
        session: summary,
        path: source.path,
        readMessages: source.agentId === 'claude'
          ? (fromOffset, progress) => iterateClaudeConversation(source.path!, fromOffset, progress)
          : (fromOffset, progress) => iterateCodexConversation(source.path!, fromOffset, progress),
      }]
    })
    if (this.searchIndex) this.scheduleSearchSync(this.searchSources)
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(key: string): Promise<ConversationHistory> {
    const source = this.sources.get(key)
    const session = this.sessions.get(key)
    if (!source || !session) throw new Error('Session is no longer available. Refresh the history list.')
    let messages: HistoryMessage[]
    if (source.agentId === 'claude' && source.path) messages = parseClaudeConversation(source.path)
    else if (source.agentId === 'codex' && source.path) messages = parseCodexConversation(source.path)
    else if (source.agentId === 'gemini' && source.path) messages = parseGeminiConversation(source.path)
    else if (source.agentId === 'opencode' && source.externalId) messages = await this.getOpenCode(source.externalId)
    else messages = []
    return { session: { ...session, messageCount: messages.length }, messages }
  }

  private async listOpenCode(account: AgentAccount): Promise<Array<{ summary: HistorySession; source: HistorySource }>> {
    const executable = detectBinary('opencode')
    if (!executable) return []
    try {
      const { stdout } = await execFileAsync(executable, ['session', 'list', '--format', 'json', '--max-count', `${MAX_SESSIONS_PER_AGENT}`], {
        timeout: 8000,
        windowsHide: true,
        shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable),
      })
      const rows = JSON.parse(stdout) as Array<Record<string, unknown>>
      return rows.map((row) => {
        const id = String(row.id ?? row.sessionID ?? '')
        const time = row.time as Record<string, unknown> | undefined
        const summary: HistorySession = {
          key: keyFor('opencode', `${account.id}:${id}`),
          agentId: 'opencode',
          title: compactTitle(row.title, `OpenCode ${id.slice(0, 8)}`),
          cwd: typeof row.directory === 'string' ? row.directory : '',
          updatedAt: epoch(time?.updated ?? row.updatedAt, Date.now()),
          resumeId: id,
          accountId: account.id,
          accountEmail: account.email,
        }
        return { summary, source: { agentId: 'opencode', externalId: id } }
      }).filter((item) => item.source.externalId)
    } catch {
      return []
    }
  }

  private async getOpenCode(id: string): Promise<HistoryMessage[]> {
    const executable = detectBinary('opencode')
    if (!executable) throw new Error('OpenCode executable was not found')
    const { stdout } = await execFileAsync(executable, ['export', id], {
      timeout: 15000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable),
    })
    return openCodeMessages(JSON.parse(stdout))
  }
}

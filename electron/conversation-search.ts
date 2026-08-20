import { mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type {
  ConversationSearchResponse,
  ConversationSearchResult,
  HistoryMessage,
  HistorySession,
  SearchIndexState,
} from './contracts'

const SCHEMA_VERSION = 1
const SEARCH_RESULT_LIMIT = 60
const HIGHLIGHT_START = '\uE000'
const HIGHLIGHT_END = '\uE001'

export interface SearchIndexSource {
  session: HistorySession
  path: string
  readMessages: () => Iterable<HistoryMessage>
}

interface SourceMetadataRow {
  mtime_ms: number
  size: number
  account_email: string
}

interface CountRow {
  count: number
}

interface SearchRow {
  source_key: string
  agent_id: string
  account_id: string
  account_email: string
  title: string
  cwd: string
  updated_at: number
  resume_id: string
  message_id: string
  ordinal: number
  role: 'user' | 'assistant'
  snippet: string
  timestamp: number | null
}

function emptyState(): SearchIndexState {
  return {
    phase: 'idle',
    discoveredSources: 0,
    processedSources: 0,
    failedSources: 0,
    indexedSources: 0,
    indexedMessages: 0,
    lastUpdatedAt: 0,
    error: '',
  }
}

function matchExpression(query: string): string {
  const tokens = query.normalize('NFKC').match(/[\p{L}\p{N}_-]+/gu) ?? []
  return tokens.slice(0, 12).map((token) => `"${token.replaceAll('"', '""')}"*`).join(' AND ')
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export class ConversationSearchIndex {
  private readonly database: Database.Database
  private state = emptyState()
  private syncQueue = Promise.resolve()

  constructor(
    databasePath: string,
    private readonly onStateChanged: (state: SearchIndexState) => void,
  ) {
    mkdirSync(dirname(databasePath), { recursive: true })
    this.database = new Database(databasePath)
    this.database.pragma('journal_mode = WAL')
    this.database.pragma('synchronous = NORMAL')
    this.database.pragma('foreign_keys = ON')
    this.migrate()
    this.refreshCounts('idle')
  }

  snapshot(): SearchIndexState {
    return { ...this.state }
  }

  synchronize(sources: SearchIndexSource[]): Promise<void> {
    this.syncQueue = this.syncQueue.then(() => this.synchronizeNow(sources)).catch((error: unknown) => {
      this.updateState({
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    })
    return this.syncQueue
  }

  async rebuild(sources: SearchIndexSource[]): Promise<SearchIndexState> {
    await this.syncQueue
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM conversation_messages_fts').run()
      this.database.prepare('DELETE FROM conversation_sources').run()
    })()
    await this.synchronize(sources)
    return this.snapshot()
  }

  search(query: string): ConversationSearchResponse {
    const normalized = query.trim().slice(0, 240)
    const expression = matchExpression(normalized)
    if (!expression) return { query: normalized, results: [], index: this.snapshot() }

    try {
      const rows = this.database.prepare(`
        SELECT
          conversation_messages_fts.source_key,
          conversation_sources.agent_id,
          conversation_sources.account_id,
          conversation_sources.account_email,
          conversation_sources.title,
          conversation_sources.cwd,
          conversation_sources.updated_at,
          conversation_sources.resume_id,
          conversation_messages_fts.message_id,
          conversation_messages_fts.ordinal,
          conversation_messages_fts.role,
          snippet(conversation_messages_fts, 6, ?, ?, ' ... ', 28) AS snippet,
          conversation_messages_fts.timestamp
        FROM conversation_messages_fts
        JOIN conversation_sources
          ON conversation_sources.source_key = conversation_messages_fts.source_key
        WHERE conversation_messages_fts MATCH ?
        ORDER BY bm25(conversation_messages_fts, 0, 0, 0, 0, 1.6, 0.35, 1.0)
        LIMIT ?
      `).all(HIGHLIGHT_START, HIGHLIGHT_END, expression, SEARCH_RESULT_LIMIT) as SearchRow[]

      const results: ConversationSearchResult[] = rows.map((row) => ({
        id: `${row.source_key}:${row.ordinal}`,
        session: {
          key: row.source_key,
          agentId: row.agent_id,
          accountId: row.account_id,
          accountEmail: row.account_email,
          title: row.title,
          cwd: row.cwd,
          updatedAt: row.updated_at,
          resumeId: row.resume_id,
        },
        messageId: row.message_id,
        ordinal: row.ordinal,
        role: row.role,
        snippet: row.snippet,
        ...(row.timestamp ? { timestamp: row.timestamp } : {}),
      }))
      return { query: normalized, results, index: this.snapshot() }
    } catch (error) {
      this.updateState({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
      return { query: normalized, results: [], index: this.snapshot() }
    }
  }

  close(): void {
    this.database.close()
  }

  private migrate(): void {
    const currentVersion = this.database.pragma('user_version', { simple: true }) as number
    if (currentVersion > SCHEMA_VERSION) throw new Error(`Search index schema ${currentVersion} is newer than supported schema ${SCHEMA_VERSION}`)
    if (currentVersion === 0) {
      this.database.transaction(() => {
        this.database.exec(`
          CREATE TABLE conversation_sources (
            source_key TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            account_id TEXT NOT NULL,
            account_email TEXT NOT NULL,
            source_path TEXT NOT NULL,
            mtime_ms REAL NOT NULL,
            size INTEGER NOT NULL,
            title TEXT NOT NULL,
            cwd TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            resume_id TEXT NOT NULL
          );

          CREATE VIRTUAL TABLE conversation_messages_fts USING fts5(
            source_key UNINDEXED,
            message_id UNINDEXED,
            ordinal UNINDEXED,
            role UNINDEXED,
            title,
            cwd,
            content,
            timestamp UNINDEXED,
            tokenize = 'unicode61'
          );

          CREATE INDEX conversation_sources_path_idx ON conversation_sources(source_path);
        `)
        this.database.pragma(`user_version = ${SCHEMA_VERSION}`)
      })()
    }
  }

  private async synchronizeNow(sources: SearchIndexSource[]): Promise<void> {
    const sourceKeys = new Set(sources.map((source) => source.session.key))
    let processedSources = 0
    let failedSources = 0
    this.updateState({
      phase: 'indexing',
      discoveredSources: sources.length,
      processedSources,
      failedSources,
      error: '',
    })

    for (const source of sources) {
      try {
        const stats = statSync(source.path)
        const existing = this.database.prepare(`
          SELECT mtime_ms, size, account_email
          FROM conversation_sources
          WHERE source_key = ?
        `).get(source.session.key) as SourceMetadataRow | undefined
        const unchanged = existing
          && existing.mtime_ms === stats.mtimeMs
          && existing.size === stats.size
          && existing.account_email === source.session.accountEmail
        if (!unchanged) this.replaceSource(source, stats.mtimeMs, stats.size, source.readMessages())
      } catch {
        failedSources += 1
      }
      processedSources += 1
      this.updateState({ processedSources, failedSources })
      await yieldToEventLoop()
    }

    const staleKeys = (this.database.prepare('SELECT source_key FROM conversation_sources').all() as Array<{ source_key: string }>)
      .map((row) => row.source_key)
      .filter((key) => !sourceKeys.has(key))
    if (staleKeys.length) {
      this.database.transaction((keys: string[]) => {
        const deleteMessages = this.database.prepare('DELETE FROM conversation_messages_fts WHERE source_key = ?')
        const deleteSource = this.database.prepare('DELETE FROM conversation_sources WHERE source_key = ?')
        for (const key of keys) {
          deleteMessages.run(key)
          deleteSource.run(key)
        }
      })(staleKeys)
    }

    this.refreshCounts('ready', {
      discoveredSources: sources.length,
      processedSources,
      failedSources,
      lastUpdatedAt: Date.now(),
      error: '',
    })
  }

  private replaceSource(source: SearchIndexSource, mtimeMs: number, size: number, messages: Iterable<HistoryMessage>): void {
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM conversation_messages_fts WHERE source_key = ?').run(source.session.key)
      this.database.prepare(`
        INSERT INTO conversation_sources (
          source_key, agent_id, account_id, account_email, source_path,
          mtime_ms, size, title, cwd, updated_at, resume_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_key) DO UPDATE SET
          agent_id = excluded.agent_id,
          account_id = excluded.account_id,
          account_email = excluded.account_email,
          source_path = excluded.source_path,
          mtime_ms = excluded.mtime_ms,
          size = excluded.size,
          title = excluded.title,
          cwd = excluded.cwd,
          updated_at = excluded.updated_at,
          resume_id = excluded.resume_id
      `).run(
        source.session.key,
        source.session.agentId,
        source.session.accountId,
        source.session.accountEmail,
        source.path,
        mtimeMs,
        size,
        source.session.title,
        source.session.cwd,
        source.session.updatedAt,
        source.session.resumeId,
      )
      const insertMessage = this.database.prepare(`
        INSERT INTO conversation_messages_fts (
          source_key, message_id, ordinal, role, title, cwd, content, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      let ordinal = 0
      for (const message of messages) {
        insertMessage.run(
          source.session.key,
          message.id,
          ordinal,
          message.role,
          source.session.title,
          source.session.cwd,
          message.text,
          message.timestamp ?? null,
        )
        ordinal += 1
      }
    })()
  }

  private refreshCounts(phase: SearchIndexState['phase'], update: Partial<SearchIndexState> = {}): void {
    const indexedSources = (this.database.prepare('SELECT count(*) AS count FROM conversation_sources').get() as CountRow).count
    const indexedMessages = (this.database.prepare('SELECT count(*) AS count FROM conversation_messages_fts').get() as CountRow).count
    this.updateState({ phase, indexedSources, indexedMessages, ...update })
  }

  private updateState(update: Partial<SearchIndexState>): void {
    this.state = { ...this.state, ...update }
    this.onStateChanged(this.snapshot())
  }
}

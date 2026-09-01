import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import type { AgentAccount, DelegationTask, DelegationTaskStatus } from './contracts'
import { startWorker, type WorkerAgentId, type WorkerHandle } from './delegation-workers'

const MAX_OPEN_TASKS = 10
const MAX_RUNNING_TASKS = 3
const APPROVAL_TIMEOUT_MS = 15 * 60 * 1000
const SNAPSHOT_LIMIT = 50
const PROMPT_PREVIEW_CHARS = 4000
const RESULT_PREVIEW_CHARS = 600
const LOG_TAIL_CHARS = 4000
const LOG_KEEP_CHARS = 64 * 1024

export interface DelegationTaskRequest {
  agent: WorkerAgentId
  prompt: string
  cwd: string
  timeoutMs: number
  caller: string
  retryOf?: string
}

export type DelegationTaskEvent = 'awaiting_approval' | 'completed' | 'failed'

interface TaskRecord {
  id: string
  agent: WorkerAgentId
  caller: string
  prompt: string
  cwd: string
  timeoutMs: number
  status: DelegationTaskStatus
  createdAt: number
  startedAt?: number
  finishedAt?: number
  account?: AgentAccount
  workerSessionId?: string
  retryOf?: string
  result?: string
  error?: string
  detail?: string
  log: string
  handle?: WorkerHandle
  approvalTimer?: ReturnType<typeof setTimeout>
  waiters: Array<() => void>
}

interface TaskRow {
  id: string
  agent: string
  caller: string
  prompt: string
  cwd: string
  timeout_ms: number
  status: string
  created_at: number
  started_at: number | null
  finished_at: number | null
  account_id: string | null
  account_email: string | null
  worker_session_id: string | null
  retry_of: string | null
  result: string | null
  error: string | null
  detail: string | null
}

const FINISHED: ReadonlySet<DelegationTaskStatus> = new Set(['completed', 'failed', 'rejected', 'cancelled'])

function preview(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

export function isFinishedStatus(status: DelegationTaskStatus): boolean {
  return FINISHED.has(status)
}

// Owns every delegated task: approval gate, worker lifecycle, progress log,
// and a sqlite record so history survives restarts.
export class DelegationTaskRegistry {
  private readonly database: Database.Database
  private readonly tasks = new Map<string, TaskRecord>()
  // Transcript ids written by workers, kept so the history list can hide them.
  private readonly workerSessionIds = new Set<string>()
  private closed = false

  constructor(
    private readonly databasePath: string,
    private readonly onChanged: () => void,
    private readonly onEvent: (task: DelegationTask, event: DelegationTaskEvent) => void,
    private readonly onWorkerSession?: (sessionId: string) => void,
  ) {
    mkdirSync(dirname(databasePath), { recursive: true })
    this.database = new Database(databasePath)
    this.database.pragma('journal_mode = WAL')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS delegation_tasks (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        caller TEXT NOT NULL,
        prompt TEXT NOT NULL,
        cwd TEXT NOT NULL,
        timeout_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        account_id TEXT,
        account_email TEXT,
        result TEXT,
        error TEXT,
        detail TEXT
      );
      CREATE INDEX IF NOT EXISTS delegation_tasks_created_idx ON delegation_tasks(created_at DESC);
    `)
    const columns = (this.database.pragma('table_info(delegation_tasks)') as Array<{ name: string }>).map((column) => column.name)
    if (!columns.includes('worker_session_id')) {
      this.database.exec('ALTER TABLE delegation_tasks ADD COLUMN worker_session_id TEXT')
      // Earlier Claude workers only recorded their session id inside `detail`.
      const legacy = this.database.prepare(`
        SELECT id, detail FROM delegation_tasks WHERE agent = 'claude' AND detail LIKE 'session %'
      `).all() as Array<{ id: string; detail: string }>
      const backfill = this.database.prepare('UPDATE delegation_tasks SET worker_session_id = ? WHERE id = ?')
      for (const row of legacy) {
        const match = /^session (\S+),/.exec(row.detail)
        if (match && match[1] !== 'unknown') backfill.run(match[1], row.id)
      }
    }
    if (!columns.includes('retry_of')) {
      this.database.exec('ALTER TABLE delegation_tasks ADD COLUMN retry_of TEXT')
    }
    for (const row of this.database.prepare('SELECT worker_session_id FROM delegation_tasks WHERE worker_session_id IS NOT NULL').all() as Array<{ worker_session_id: string }>) {
      this.workerSessionIds.add(row.worker_session_id)
    }
    // Nothing can still be running from a previous process.
    this.database.prepare(`
      UPDATE delegation_tasks SET status = 'failed', finished_at = ?, error = ?
      WHERE status IN ('awaiting_approval', 'running')
    `).run(Date.now(), 'MoaCLI was closed before the task finished')
    const rows = this.database.prepare(`
      SELECT * FROM delegation_tasks ORDER BY created_at DESC LIMIT ?
    `).all(SNAPSHOT_LIMIT) as TaskRow[]
    for (const row of rows.reverse()) this.tasks.set(row.id, this.recordFromRow(row))
  }

  snapshot(): DelegationTask[] {
    return [...this.tasks.values()]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, SNAPSHOT_LIMIT)
      .map((record) => this.publicTask(record))
  }

  get(taskId: string): DelegationTask | undefined {
    const record = this.tasks.get(taskId) ?? this.loadRecord(taskId)
    return record ? this.publicTask(record) : undefined
  }

  isWorkerSession(sessionId: string): boolean {
    return this.workerSessionIds.has(sessionId)
  }

  workerSessions(): string[] {
    return [...this.workerSessionIds]
  }

  create(request: DelegationTaskRequest): DelegationTask {
    if (this.closed) throw new Error('MoaCLI is shutting down')
    const open = [...this.tasks.values()].filter((record) => !isFinishedStatus(record.status))
    if (open.length >= MAX_OPEN_TASKS) throw new Error(`Too many delegated tasks are already open (${MAX_OPEN_TASKS}); wait for some to finish`)
    const record: TaskRecord = {
      id: randomUUID(),
      agent: request.agent,
      caller: request.caller,
      prompt: request.prompt,
      cwd: request.cwd,
      timeoutMs: request.timeoutMs,
      status: 'awaiting_approval',
      createdAt: Date.now(),
      ...(request.retryOf ? { retryOf: request.retryOf } : {}),
      log: '',
      waiters: [],
    }
    this.tasks.set(record.id, record)
    this.database.prepare(`
      INSERT INTO delegation_tasks (id, agent, caller, prompt, cwd, timeout_ms, status, created_at, retry_of)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.agent, record.caller, record.prompt, record.cwd, record.timeoutMs, record.status, record.createdAt, record.retryOf ?? null)
    record.approvalTimer = setTimeout(() => {
      if (record.status === 'awaiting_approval') this.finish(record, 'rejected', { error: 'Nobody approved the task within 15 minutes' })
    }, APPROVAL_TIMEOUT_MS)
    this.trimHistory()
    this.onChanged()
    this.onEvent(this.publicTask(record), 'awaiting_approval')
    return this.publicTask(record)
  }

  approve(taskId: string, account?: AgentAccount): void {
    const record = this.requireTask(taskId)
    if (record.status !== 'awaiting_approval') throw new Error('The task is no longer waiting for approval')
    const running = [...this.tasks.values()].filter((item) => item.status === 'running').length
    if (running >= MAX_RUNNING_TASKS) throw new Error(`At most ${MAX_RUNNING_TASKS} delegated tasks can run at once`)
    clearTimeout(record.approvalTimer)
    record.approvalTimer = undefined
    if (account && account.agentId === record.agent) record.account = account
    record.status = 'running'
    record.startedAt = Date.now()
    this.database.prepare(`
      UPDATE delegation_tasks SET status = ?, started_at = ?, account_id = ?, account_email = ? WHERE id = ?
    `).run(record.status, record.startedAt, record.account?.id ?? null, record.account?.email ?? null, record.id)
    try {
      record.handle = startWorker({
        agent: record.agent,
        prompt: record.prompt,
        cwd: record.cwd,
        timeoutMs: record.timeoutMs,
        ...(record.account ? { account: record.account } : {}),
        onProgress: (line) => this.appendLog(record, line),
        onSessionId: (sessionId) => this.recordWorkerSession(record, sessionId),
      })
    } catch (error) {
      this.finish(record, 'failed', { error: error instanceof Error ? error.message : String(error) })
      return
    }
    this.onChanged()
    record.handle.done.then((result) => {
      this.finish(record, 'completed', { result: result.text, detail: result.detail })
    }, (error: unknown) => {
      if (record.status === 'cancelled') return
      this.finish(record, 'failed', { error: error instanceof Error ? error.message : String(error) })
    })
  }

  // Re-queues a finished task as a fresh approval request, so the user can
  // pick another account (e.g. after a usage limit or an expired sign-in).
  retry(taskId: string): DelegationTask {
    const original = this.requireTask(taskId)
    if (original.status !== 'failed' && original.status !== 'cancelled') {
      throw new Error('Only failed or cancelled tasks can be retried')
    }
    return this.create({
      agent: original.agent,
      prompt: original.prompt,
      cwd: original.cwd,
      timeoutMs: original.timeoutMs,
      caller: original.caller,
      retryOf: original.id,
    })
  }

  reject(taskId: string): void {
    const record = this.requireTask(taskId)
    if (record.status !== 'awaiting_approval') throw new Error('The task is no longer waiting for approval')
    this.finish(record, 'rejected', { error: 'The user declined the delegation' })
  }

  cancel(taskId: string): void {
    const record = this.requireTask(taskId)
    if (record.status === 'awaiting_approval') {
      this.finish(record, 'cancelled', { error: 'The task was cancelled before it started' })
    } else if (record.status === 'running') {
      const handle = record.handle
      this.finish(record, 'cancelled', { error: 'The task was cancelled while running' })
      handle?.cancel()
    }
  }

  // Resolves once the task reaches a final status.
  waitForFinish(taskId: string): Promise<DelegationTask> {
    const record = this.requireTask(taskId)
    if (isFinishedStatus(record.status)) return Promise.resolve(this.publicTask(record))
    return new Promise((resolve) => {
      record.waiters.push(() => resolve(this.publicTask(record)))
    })
  }

  logTail(taskId: string): string {
    const record = this.requireTask(taskId)
    return record.log.length <= LOG_TAIL_CHARS ? record.log : `…${record.log.slice(-LOG_TAIL_CHARS)}`
  }

  result(taskId: string): { task: DelegationTask; text: string } {
    const record = this.requireTask(taskId)
    return { task: this.publicTask(record), text: record.result ?? '' }
  }

  // Large results are handed to callers as a file path instead of inline text.
  writeResultFile(taskId: string, resultsDirectory: string): string {
    const record = this.requireTask(taskId)
    mkdirSync(resultsDirectory, { recursive: true })
    const path = join(resultsDirectory, `${record.id}.txt`)
    writeFileSync(path, record.result ?? '', 'utf8')
    return path
  }

  close(): void {
    this.closed = true
    for (const record of this.tasks.values()) {
      clearTimeout(record.approvalTimer)
      if (record.status === 'running') {
        record.status = 'cancelled'
        record.handle?.cancel()
      }
    }
    this.database.prepare(`
      UPDATE delegation_tasks SET status = 'failed', finished_at = ?, error = ?
      WHERE status IN ('awaiting_approval', 'running')
    `).run(Date.now(), 'MoaCLI was closed before the task finished')
    this.database.close()
  }

  private requireTask(taskId: string): TaskRecord {
    const record = this.tasks.get(taskId) ?? this.loadRecord(taskId)
    if (!record) throw new Error(`Unknown task: ${taskId}`)
    return record
  }

  // Finished tasks older than the in-memory window still answer status queries.
  private loadRecord(taskId: string): TaskRecord | undefined {
    if (this.closed) return undefined
    const row = this.database.prepare('SELECT * FROM delegation_tasks WHERE id = ?').get(taskId) as TaskRow | undefined
    return row ? this.recordFromRow(row) : undefined
  }

  private recordWorkerSession(record: TaskRecord, sessionId: string): void {
    if (record.workerSessionId === sessionId || this.closed) return
    record.workerSessionId = sessionId
    this.workerSessionIds.add(sessionId)
    this.database.prepare('UPDATE delegation_tasks SET worker_session_id = ? WHERE id = ?').run(sessionId, record.id)
    this.onWorkerSession?.(sessionId)
  }

  private appendLog(record: TaskRecord, line: string): void {
    record.log = `${record.log}${line}\n`
    if (record.log.length > LOG_KEEP_CHARS) record.log = record.log.slice(-LOG_KEEP_CHARS)
  }

  private finish(record: TaskRecord, status: DelegationTaskStatus, outcome: { result?: string; error?: string; detail?: string }): void {
    if (isFinishedStatus(record.status)) return
    clearTimeout(record.approvalTimer)
    record.approvalTimer = undefined
    record.status = status
    record.finishedAt = Date.now()
    record.result = outcome.result
    record.error = outcome.error
    record.detail = outcome.detail
    record.handle = undefined
    if (!this.closed) {
      this.database.prepare(`
        UPDATE delegation_tasks SET status = ?, finished_at = ?, result = ?, error = ?, detail = ? WHERE id = ?
      `).run(status, record.finishedAt, record.result ?? null, record.error ?? null, record.detail ?? null, record.id)
    }
    const waiters = record.waiters.splice(0)
    for (const waiter of waiters) waiter()
    if (this.closed) return
    this.onChanged()
    if (status === 'completed') this.onEvent(this.publicTask(record), 'completed')
    else if (status === 'failed') this.onEvent(this.publicTask(record), 'failed')
  }

  private trimHistory(): void {
    const finished = [...this.tasks.values()]
      .filter((record) => isFinishedStatus(record.status))
      .sort((left, right) => right.createdAt - left.createdAt)
    for (const record of finished.slice(SNAPSHOT_LIMIT)) this.tasks.delete(record.id)
  }

  private recordFromRow(row: TaskRow): TaskRecord {
    return {
      id: row.id,
      agent: row.agent === 'codex' ? 'codex' : 'claude',
      caller: row.caller,
      prompt: row.prompt,
      cwd: row.cwd,
      timeoutMs: row.timeout_ms,
      status: row.status as DelegationTaskStatus,
      createdAt: row.created_at,
      ...(row.started_at ? { startedAt: row.started_at } : {}),
      ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
      ...(row.account_id ? { account: { id: row.account_id, agentId: row.agent, email: row.account_email ?? '', configDir: '' } } : {}),
      ...(row.worker_session_id ? { workerSessionId: row.worker_session_id } : {}),
      ...(row.retry_of ? { retryOf: row.retry_of } : {}),
      ...(row.result ? { result: row.result } : {}),
      ...(row.error ? { error: row.error } : {}),
      ...(row.detail ? { detail: row.detail } : {}),
      log: '',
      waiters: [],
    }
  }

  private publicTask(record: TaskRecord): DelegationTask {
    return {
      id: record.id,
      agent: record.agent,
      caller: record.caller,
      promptPreview: preview(record.prompt, PROMPT_PREVIEW_CHARS),
      promptLength: record.prompt.length,
      cwd: record.cwd,
      timeoutMs: record.timeoutMs,
      status: record.status,
      createdAt: record.createdAt,
      ...(record.startedAt ? { startedAt: record.startedAt } : {}),
      ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
      ...(record.account ? { accountId: record.account.id, accountEmail: record.account.email } : {}),
      ...(record.workerSessionId ? { workerSessionId: record.workerSessionId } : {}),
      ...(record.retryOf ? { retryOfId: record.retryOf } : {}),
      ...(record.result ? { resultPreview: preview(record.result, RESULT_PREVIEW_CHARS) } : {}),
      ...(record.error ? { error: record.error } : {}),
      ...(record.detail ? { detail: record.detail } : {}),
    }
  }
}

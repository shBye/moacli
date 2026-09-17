import { isWorkerAgent, validateModel } from '../src/features/delegation/model-policy'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import type { AgentAccount, DelegationTask, DelegationTaskStatus } from './contracts'
import { startWorker, type WorkerAgentId, type WorkerHandle } from './delegation-workers'
import type { ReviewEntry, ReviewMetadata, ReviewSource } from './review-contracts'
import { assertRootCaller, canStartDelegation, MAX_OPEN_TASKS, singleLevelPrompt, type DelegationMode } from './delegation-policy'

const APPROVAL_TIMEOUT_MS = 15 * 60 * 1000
const SNAPSHOT_LIMIT = 50
const PROMPT_PREVIEW_CHARS = 4000
const RESULT_PREVIEW_CHARS = 600
const LOG_TAIL_CHARS = 4000
const LOG_KEEP_CHARS = 64 * 1024

export interface DelegationTaskRequest {
  source?: ReviewSource
  callerDepth?: number
  mode?: DelegationMode
  role?: string
  agent: WorkerAgentId
  prompt: string
  cwd: string
  timeoutMs: number
  caller: string
  retryOf?: string
  review?: ReviewMetadata
}

export type DelegationTaskEvent = 'awaiting_approval' | 'completed' | 'failed'

interface TaskRecord {
  model?: string
  source?: ReviewSource
  mode: DelegationMode
  role?: string
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
  review?: ReviewMetadata
  result?: string
  error?: string
  detail?: string
  log: string
  handle?: WorkerHandle
  cancelRequested?: boolean
  approvalTimer?: ReturnType<typeof setTimeout>
  waiters: Array<() => void>
}

interface TaskRow {
  model: string | null
  source_json: string | null
  mode: string | null
  role: string | null
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
  review_json: string | null
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
    private readonly workerStarter: typeof startWorker = startWorker,
    private readonly resolveModel: (agent: WorkerAgentId, account?: AgentAccount, model?: string) => string = (_agent, _account, model) => validateModel(model ?? ''),
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
    if (!columns.includes('model')) this.database.exec('ALTER TABLE delegation_tasks ADD COLUMN model TEXT')
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
    if (!columns.includes('review_json')) {
      this.database.exec('ALTER TABLE delegation_tasks ADD COLUMN review_json TEXT')
    }
    if (!columns.includes('mode')) this.database.exec("ALTER TABLE delegation_tasks ADD COLUMN mode TEXT NOT NULL DEFAULT 'analyze'")
    if (!columns.includes('role')) this.database.exec('ALTER TABLE delegation_tasks ADD COLUMN role TEXT')
    if (!columns.includes('source_json')) this.database.exec('ALTER TABLE delegation_tasks ADD COLUMN source_json TEXT')
    for (const row of this.database.prepare('SELECT worker_session_id FROM delegation_tasks WHERE worker_session_id IS NOT NULL').all() as Array<{ worker_session_id: string }>) {
      this.workerSessionIds.add(row.worker_session_id)
    }
    // Nothing can still be running from a previous process.
    this.database.prepare(`
      UPDATE delegation_tasks SET status = 'failed', finished_at = ?, error = ?
      WHERE status IN ('awaiting_approval', 'queued', 'running')
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

  syncTaskSource(source: ReviewSource): void {
    if (!source.historyKey) return
    this.database.transaction(() => {
      const reviews = this.database.prepare(`SELECT id, review_json FROM delegation_tasks WHERE review_json IS NOT NULL
        AND json_extract(review_json, '$.source.sessionId') = ?
        AND json_extract(review_json, '$.source.historyKey') = ''`).all(source.sessionId) as Array<{ id: string; review_json: string }>
      for (const row of reviews) {
        const review = JSON.parse(row.review_json) as ReviewMetadata
        review.source.historyKey = source.historyKey
        this.database.prepare('UPDATE delegation_tasks SET review_json = ? WHERE id = ?').run(JSON.stringify(review), row.id)
        const live = this.tasks.get(row.id)
        if (live) live.review = review
      }
      const tasks = this.database.prepare(`SELECT id, source_json FROM delegation_tasks WHERE source_json IS NOT NULL
        AND json_extract(source_json, '$.sessionId') = ?
        AND json_extract(source_json, '$.historyKey') = ''`).all(source.sessionId) as Array<{ id: string; source_json: string }>
      for (const row of tasks) {
        const linked = { ...JSON.parse(row.source_json) as ReviewSource, historyKey: source.historyKey }
        this.database.prepare('UPDATE delegation_tasks SET source_json = ? WHERE id = ?').run(JSON.stringify(linked), row.id)
        const live = this.tasks.get(row.id)
        if (live) live.source = linked
      }
    })()
  }

  listReviews(source: ReviewSource): ReviewEntry[] {
    const rows = this.database.prepare(`
      SELECT * FROM delegation_tasks WHERE review_json IS NOT NULL
      AND (json_extract(review_json, '$.source.sessionId') = ?
        OR (? != '' AND json_extract(review_json, '$.source.historyKey') = ?))
      ORDER BY created_at DESC LIMIT 30
    `).all(source.sessionId, source.historyKey, source.historyKey) as TaskRow[]
    return rows.map((row) => {
      const record = this.tasks.get(row.id) ?? this.recordFromRow(row)
      return { task: this.publicTask(record), review: record.review!, result: record.result ?? '' }
    })
  }

  listSessionTasks(source: ReviewSource): DelegationTask[] {
    // List queries never load full prompts, results or snapshot patches.
    const rows = this.database.prepare(`SELECT id, agent, caller, cwd, timeout_ms, status,
      created_at, started_at, finished_at, account_id, account_email, worker_session_id,
      retry_of, mode, role, model, source_json, error, detail, NULL AS review_json,
      substr(prompt, 1, 4000) AS prompt, length(prompt) AS prompt_length,
      substr(result, 1, 600) AS result
      FROM delegation_tasks WHERE source_json IS NOT NULL
      AND (json_extract(source_json, '$.sessionId') = ?
        OR (? != '' AND json_extract(source_json, '$.historyKey') = ?))
      ORDER BY created_at DESC, rowid DESC LIMIT 30`).all(source.sessionId, source.historyKey, source.historyKey) as Array<TaskRow & { prompt_length: number }>
    return rows.map((row) => {
      const record = this.tasks.get(row.id) ?? this.recordFromRow(row)
      return { ...this.publicTask(record), promptLength: this.tasks.has(row.id) ? record.prompt.length : row.prompt_length }
    })
  }

  create(request: DelegationTaskRequest): DelegationTask {
    assertRootCaller(request.callerDepth ?? 0)
    if (this.closed) throw new Error('MoaCLI is shutting down')
    const open = [...this.tasks.values()].filter((record) => !isFinishedStatus(record.status))
    if (open.length >= MAX_OPEN_TASKS) throw new Error(`Too many delegated tasks are already open (${MAX_OPEN_TASKS}); wait for some to finish`)
    const record: TaskRecord = {
      source: request.source ? { ...request.source } : undefined,
      mode: request.review ? 'analyze' : request.mode ?? 'analyze',
      role: request.role ?? request.review?.role,
      id: randomUUID(),
      agent: request.agent,
      caller: request.caller,
      prompt: request.prompt,
      cwd: request.cwd,
      timeoutMs: request.timeoutMs,
      status: 'awaiting_approval',
      createdAt: Date.now(),
      ...(request.retryOf ? { retryOf: request.retryOf } : {}),
      ...(request.review ? { review: request.review } : {}),
      log: '',
      waiters: [],
    }
    this.tasks.set(record.id, record)
    this.database.prepare(`
      INSERT INTO delegation_tasks (id, agent, caller, prompt, cwd, timeout_ms, status, created_at, retry_of, review_json, mode, role, source_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.agent, record.caller, record.prompt, record.cwd, record.timeoutMs, record.status, record.createdAt, record.retryOf ?? null, record.review ? JSON.stringify(record.review) : null, record.mode, record.role ?? null, record.source ? JSON.stringify(record.source) : null)
    record.approvalTimer = setTimeout(() => {
      if (record.status === 'awaiting_approval') this.finish(record, 'rejected', { error: 'Nobody approved the task within 15 minutes' })
    }, APPROVAL_TIMEOUT_MS)
    this.trimHistory()
    this.onChanged()
    this.onEvent(this.publicTask(record), 'awaiting_approval')
    return this.publicTask(record)
  }

  approve(taskId: string, account?: AgentAccount, model?: string): void {
    const record = this.requireTask(taskId)
    if (record.status !== 'awaiting_approval') throw new Error('The task is no longer waiting for approval')
    if (account && account.agentId !== record.agent) throw new Error('The selected account does not match the worker agent')
    record.model = validateModel(this.resolveModel(record.agent, account, model))
    clearTimeout(record.approvalTimer)
    record.approvalTimer = undefined
    if (account && account.agentId === record.agent) record.account = account
    record.status = 'queued'
    this.database.prepare('UPDATE delegation_tasks SET status = ?, account_id = ?, account_email = ?, model = ? WHERE id = ?')
      .run(record.status, record.account?.id ?? null, record.account?.email ?? null, record.model, record.id)
    this.drainQueue()
    this.onChanged()
  }

  private drainQueue(): void {
    if (this.closed) return
    const pending = [...this.tasks.values()].filter((task) => task.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)
    for (const task of pending) {
      const running = [...this.tasks.values()].filter((item) => item.status === 'running')
      if (canStartDelegation(task, running)) this.startApproved(task)
    }
  }

  private startApproved(record: TaskRecord): void {
    record.status = 'running'
    record.startedAt = Date.now()
    this.database.prepare(`
      UPDATE delegation_tasks SET status = ?, started_at = ?, account_id = ?, account_email = ? WHERE id = ?
    `).run(record.status, record.startedAt, record.account?.id ?? null, record.account?.email ?? null, record.id)
    try {
      record.handle = this.workerStarter({
        model: record.model,
        agent: record.agent,
        prompt: singleLevelPrompt(record.prompt, record.mode),
        mode: record.mode,
        cwd: record.cwd,
        timeoutMs: record.timeoutMs,
        reviewOnly: Boolean(record.review),
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
      if (record.cancelRequested) { this.finish(record, 'cancelled', { error: 'The task was cancelled' }); return }
      this.finish(record, 'completed', { result: result.text, detail: result.detail })
    }, (error: unknown) => {
      if (record.status === 'cancelled') return
      if (record.cancelRequested) { this.finish(record, 'cancelled', { error: 'The task was cancelled' }); return }
      this.finish(record, 'failed', { error: error instanceof Error ? error.message : String(error) })
    })
  }

  // Re-queues a finished task as a fresh approval request, so the user can
  // pick another account (e.g. after a usage limit or an expired sign-in).
  retry(taskId: string): DelegationTask {
    const original = this.requireTask(taskId)
    if (original.review) throw new Error('Open the original session’s Review tab and start a new review with a fresh change snapshot.')
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
      source: original.source,
      review: original.review,
      mode: original.mode,
      role: original.role,
    })
  }

  reject(taskId: string): void {
    const record = this.requireTask(taskId)
    if (record.status !== 'awaiting_approval') throw new Error('The task is no longer waiting for approval')
    this.finish(record, 'rejected', { error: 'The user declined the delegation' })
  }

  cancel(taskId: string): void {
    const record = this.requireTask(taskId)
    if (record.status === 'awaiting_approval' || record.status === 'queued') {
      this.finish(record, 'cancelled', { error: 'The task was cancelled before it started' })
    } else if (record.status === 'running') {
      const handle = record.handle
      record.cancelRequested = true
      handle?.cancel()
      // Keep the slot/workspace reserved until the worker has actually exited.
      record.error = 'Cancellation requested'
      this.onChanged()
    }
  }

  // Resolves once the task reaches a final status.
  waitForFinish(taskId: string, timeoutMs?: number): Promise<DelegationTask> {
    const record = this.requireTask(taskId)
    if (isFinishedStatus(record.status)) return Promise.resolve(this.publicTask(record))
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const done = () => {
        clearTimeout(timer)
        const index = record.waiters.indexOf(done)
        if (index >= 0) record.waiters.splice(index, 1)
        resolve(this.publicTask(record))
      }
      record.waiters.push(done)
      if (timeoutMs !== undefined) timer = setTimeout(done, timeoutMs)
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
      if (record.status === 'awaiting_approval' || record.status === 'queued') record.status = 'cancelled'
      for (const done of record.waiters.splice(0)) done()
    }
    this.database.prepare(`
      UPDATE delegation_tasks SET status = 'failed', finished_at = ?, error = ?
      WHERE status IN ('awaiting_approval', 'queued', 'running')
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
    queueMicrotask(() => this.drainQueue())
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
      model: row.model ?? undefined,
      ...(row.source_json ? { source: JSON.parse(row.source_json) as ReviewSource } : {}),
      mode: row.mode === 'edit' ? 'edit' : 'analyze',
      ...(row.role ? { role: row.role } : {}),
      id: row.id,
      agent: isWorkerAgent(row.agent) ? row.agent : 'claude',
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
      ...(row.review_json ? { review: JSON.parse(row.review_json) as ReviewMetadata } : {}),
      log: '',
      waiters: [],
    }
  }

  private publicTask(record: TaskRecord): DelegationTask {
    return {
      model: record.model,
      ...(record.source ? { source: { ...record.source } } : {}),
      mode: record.mode,
      role: record.role,
      depth: 1,
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
      ...(record.review ? { reviewSource: record.review.source } : {}),
    }
  }
}

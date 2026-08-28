import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectBinary, executableCommand } from './agent-profiles'
import type { AgentAccount } from './contracts'

export type WorkerAgentId = 'claude' | 'codex'

export const WORKER_AGENT_IDS: readonly WorkerAgentId[] = ['claude', 'codex']

export interface WorkerStart {
  agent: WorkerAgentId
  prompt: string
  cwd: string
  timeoutMs: number
  account?: AgentAccount
  // Receives a human-readable progress line as the worker reports activity.
  onProgress: (line: string) => void
  // Receives the session/thread id the worker CLI writes its transcript under.
  onSessionId?: (sessionId: string) => void
}

export interface WorkerResult {
  text: string
  detail: string
}

export interface WorkerHandle {
  done: Promise<WorkerResult>
  cancel: () => void
}

interface ProcessOutcome {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
  cancelled: boolean
}

const PROGRESS_LINE_CHARS = 240

function truncateOutput(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n… (truncated ${value.length - limit} chars)`
}

function compactLine(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= PROGRESS_LINE_CHARS ? compact : `${compact.slice(0, PROGRESS_LINE_CHARS)}…`
}

function quoteForShell(argument: string): string {
  return /[\s"]/.test(argument) ? `"${argument.replace(/"/g, '""')}"` : argument
}

function killWorkerTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  } else {
    try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
  }
}

function workerEnvironment(start: WorkerStart): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, MOACLI_DELEGATED: '1', MOACLI_DELEGATION_DEPTH: '1' }
  const account = start.account
  if (account?.configDir && !account.detected) {
    if (start.agent === 'claude') environment.CLAUDE_CONFIG_DIR = account.configDir
    if (start.agent === 'codex') environment.CODEX_HOME = account.configDir
  }
  return environment
}

// Feeds newline-delimited stdout to `onLine` as it arrives; the full stdout is
// still collected for the final result.
function runWorkerProcess(
  binary: string,
  args: string[],
  start: WorkerStart,
  onLine: (line: string) => void,
): { outcome: Promise<ProcessOutcome>; cancel: () => void } {
  const command = executableCommand(binary, args)
  const finalArgs = command.shell ? command.args.map(quoteForShell) : command.args
  let child: ChildProcess | undefined
  let cancelled = false
  const outcome = new Promise<ProcessOutcome>((resolve, reject) => {
    const spawned = spawn(command.file, finalArgs, {
      cwd: start.cwd,
      env: workerEnvironment(start),
      shell: command.shell,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child = spawned
    let stdout = ''
    let stderr = ''
    let pendingLine = ''
    let settled = false
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killWorkerTree(spawned.pid)
    }, start.timeoutMs)
    spawned.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stdout += text
      pendingLine += text
      let newline = pendingLine.indexOf('\n')
      while (newline >= 0) {
        const line = pendingLine.slice(0, newline).trim()
        pendingLine = pendingLine.slice(newline + 1)
        if (line) onLine(line)
        newline = pendingLine.indexOf('\n')
      }
    })
    spawned.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    spawned.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    spawned.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (pendingLine.trim()) onLine(pendingLine.trim())
      resolve({ stdout, stderr, exitCode: code ?? -1, timedOut, cancelled })
    })
    spawned.stdin?.on('error', () => { /* the worker may exit before reading its prompt */ })
    spawned.stdin?.write(start.prompt, () => spawned.stdin?.end())
  })
  return {
    outcome,
    cancel: () => {
      cancelled = true
      killWorkerTree(child?.pid)
    },
  }
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line)
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

function describeToolInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const record = input as Record<string, unknown>
  for (const key of ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description']) {
    if (typeof record[key] === 'string') return record[key] as string
  }
  return ''
}

// Claude Code stream-json: assistant messages carry text and tool_use blocks;
// the final `result` event carries the answer.
function claudeProgress(event: Record<string, unknown>): string | null {
  if (event.type !== 'assistant') return null
  const message = event.message as Record<string, unknown> | undefined
  const content = Array.isArray(message?.content) ? message.content as Array<Record<string, unknown>> : []
  const lines: string[] = []
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) lines.push(compactLine(block.text))
    else if (block.type === 'tool_use') lines.push(compactLine(`[${String(block.name ?? 'tool')}] ${describeToolInput(block.input)}`))
  }
  return lines.length ? lines.join('\n') : null
}

// Codex exec --json: item.completed events describe messages and commands.
function codexProgress(event: Record<string, unknown>): string | null {
  if (event.type !== 'item.completed') return null
  const item = event.item as Record<string, unknown> | undefined
  if (!item) return null
  if (item.type === 'agent_message' && typeof item.text === 'string') return compactLine(item.text)
  if (item.type === 'reasoning' && typeof item.text === 'string') return compactLine(`(thinking) ${item.text}`)
  if (item.type === 'command_execution' && typeof item.command === 'string') {
    const exit = typeof item.exit_code === 'number' ? ` → exit ${item.exit_code}` : ''
    return compactLine(`[command] ${item.command}${exit}`)
  }
  if ((item.type === 'file_change' || item.type === 'patch') && Array.isArray(item.changes)) {
    return compactLine(`[edit] ${(item.changes as Array<Record<string, unknown>>).map((change) => String(change.path ?? '')).join(', ')}`)
  }
  return null
}

function startClaudeWorker(start: WorkerStart): WorkerHandle {
  const binary = detectBinary('claude')
  if (!binary) throw new Error('Claude Code CLI was not found on this machine')
  // MCP servers are disabled inside the worker so a delegated task can never
  // reach back into MoaCLI and delegate again.
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose', '--max-turns', '30',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
  ]
  let finalEvent: Record<string, unknown> | undefined
  const { outcome, cancel } = runWorkerProcess(binary, args, start, (line) => {
    const event = parseJsonLine(line)
    if (!event) return
    if (typeof event.session_id === 'string' && event.session_id && (event.type === 'system' || event.type === 'result')) {
      start.onSessionId?.(event.session_id)
    }
    if (event.type === 'result') {
      finalEvent = event
      return
    }
    const progress = claudeProgress(event)
    if (progress) start.onProgress(progress)
  })
  const done = outcome.then(({ stdout, stderr, exitCode, timedOut, cancelled }) => {
    if (cancelled) throw new Error('Claude worker was cancelled')
    if (timedOut) throw new Error(`Claude worker timed out after ${start.timeoutMs / 1000}s`)
    if (!finalEvent || typeof finalEvent.result !== 'string') {
      if (exitCode !== 0) {
        throw new Error(`Claude worker exited with code ${exitCode}: ${truncateOutput(stderr.trim() || stdout.trim(), 2000)}`)
      }
      throw new Error(`Claude worker produced no result: ${truncateOutput(stderr.trim() || stdout.trim(), 2000)}`)
    }
    if (finalEvent.is_error === true) {
      throw new Error(`Claude worker reported an error (${String(finalEvent.subtype ?? 'unknown')}): ${truncateOutput(finalEvent.result, 2000)}`)
    }
    const cost = typeof finalEvent.total_cost_usd === 'number' ? `$${finalEvent.total_cost_usd.toFixed(4)}` : 'unknown cost'
    return {
      text: finalEvent.result,
      detail: `session ${String(finalEvent.session_id ?? 'unknown')}, ${cost}`,
    }
  })
  return { done, cancel }
}

function startCodexWorker(start: WorkerStart): WorkerHandle {
  const binary = detectBinary('codex')
  if (!binary) throw new Error('Codex CLI was not found on this machine')
  const lastMessageDirectory = join(tmpdir(), 'moacli', 'delegation')
  mkdirSync(lastMessageDirectory, { recursive: true })
  const lastMessagePath = join(lastMessageDirectory, `codex-${randomUUID()}.txt`)
  const args = ['exec', '--json', '--skip-git-repo-check', '--output-last-message', lastMessagePath, '-']
  const { outcome, cancel } = runWorkerProcess(binary, args, start, (line) => {
    const event = parseJsonLine(line)
    if (!event) return
    if (event.type === 'thread.started' && typeof event.thread_id === 'string' && event.thread_id) start.onSessionId?.(event.thread_id)
    const progress = codexProgress(event)
    if (progress) start.onProgress(progress)
  })
  const done = outcome.then(({ stdout, stderr, exitCode, timedOut, cancelled }) => {
    if (cancelled) throw new Error('Codex worker was cancelled')
    if (timedOut) throw new Error(`Codex worker timed out after ${start.timeoutMs / 1000}s`)
    const lastMessage = existsSync(lastMessagePath) ? readFileSync(lastMessagePath, 'utf8').trim() : ''
    if (exitCode !== 0 && !lastMessage) {
      throw new Error(`Codex worker exited with code ${exitCode}: ${truncateOutput(stderr.trim() || stdout.trim(), 2000)}`)
    }
    if (!lastMessage) throw new Error('Codex worker finished without a final message')
    return { text: lastMessage, detail: `exit code ${exitCode}, read-only sandbox` }
  }).finally(() => {
    rmSync(lastMessagePath, { force: true })
  })
  return { done, cancel }
}

const WORKER_STARTERS: Record<WorkerAgentId, (start: WorkerStart) => WorkerHandle> = {
  claude: startClaudeWorker,
  codex: startCodexWorker,
}

export function describeWorkerPolicy(agent: WorkerAgentId): string {
  return agent === 'claude'
    ? 'Claude Code default permissions: cannot approve risky actions, MCP servers disabled'
    : 'Codex read-only sandbox'
}

export function listWorkerAgents(): { id: WorkerAgentId; available: boolean; path: string | null; policy: string }[] {
  return WORKER_AGENT_IDS.map((id) => {
    const path = detectBinary(id)
    return { id, available: Boolean(path), path, policy: describeWorkerPolicy(id) }
  })
}

export function startWorker(start: WorkerStart): WorkerHandle {
  return WORKER_STARTERS[start.agent](start)
}

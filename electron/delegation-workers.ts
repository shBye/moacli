import { WORKER_AGENTS, type WorkerModelAgent } from '../src/features/delegation/model-policy'
import { runWorkerProcess } from './run-worker-process'
import { startFileWorker } from './start-file-worker'
import { workerModelArgs } from '../src/features/delegation/model-policy'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectBinary } from './agent-profiles'
import type { AgentAccount } from './contracts'
import { reviewWorkerArgs } from './review-worker-policy'
import { delegatedWorkerArgs, type DelegationMode } from './delegation-policy'

export type WorkerAgentId = WorkerModelAgent
export const WORKER_AGENT_IDS = WORKER_AGENTS

export interface WorkerStart {
  model?: string
  agent: WorkerAgentId
  prompt: string
  cwd: string
  timeoutMs: number
  account?: AgentAccount
  reviewOnly?: boolean
  mode?: DelegationMode
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

const PROGRESS_LINE_CHARS = 240

function truncateOutput(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n… (truncated ${value.length - limit} chars)`
}

function compactLine(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= PROGRESS_LINE_CHARS ? compact : `${compact.slice(0, PROGRESS_LINE_CHARS)}…`
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
  // Remove the normal MCP route back into MoaCLI. This is a worker policy,
  // not OS isolation against a process deliberately using shell-based bypasses.
  const args = [
    ...workerModelArgs(start.model),
    '-p', '--output-format', 'stream-json', '--verbose', '--max-turns', '30',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    ...(start.reviewOnly ? reviewWorkerArgs('claude') : delegatedWorkerArgs('claude', start.mode ?? 'analyze')),
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
    if (exitCode !== 0) throw new Error(`Claude worker exited with code ${exitCode}: ${truncateOutput(stderr.trim() || stdout.trim(), 2000)}`)
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
  const args = ['exec', ...workerModelArgs(start.model), '--json', '--skip-git-repo-check', '--output-last-message', lastMessagePath, '-']
  args.splice(args.length - 1, 0, ...delegatedWorkerArgs('codex', start.mode ?? 'analyze'), ...(start.reviewOnly ? reviewWorkerArgs('codex') : []))
  // Avoid loading project-local MCP/skills by starting outside the project.
  // The requested project is explicitly named and only added as writable for edit tasks.
  const runDirectory = join(tmpdir(), 'moacli-workers', randomUUID())
  mkdirSync(runDirectory, { recursive: true })
  if (start.mode === 'edit' && !start.reviewOnly) args.splice(args.length - 1, 0, '--add-dir', start.cwd)
  const workerStart = { ...start, cwd: runDirectory, prompt: `Target project directory: ${start.cwd}\nUse absolute paths when inspecting or changing the target project.\n\n${start.prompt}` }
  const { outcome, cancel } = runWorkerProcess(binary, args, workerStart, (line) => {
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
    if (exitCode !== 0) {
      throw new Error(`Codex worker exited with code ${exitCode}: ${truncateOutput(stderr.trim() || stdout.trim(), 2000)}`)
    }
    if (!lastMessage) throw new Error('Codex worker finished without a final message')
    return { text: lastMessage, detail: `exit code ${exitCode}, ${start.mode === 'edit' ? 'workspace-write' : 'read-only'} sandbox; no agent delegation` }
  }).finally(() => {
    rmSync(lastMessagePath, { force: true })
    // Remove only our empty scratch directory; never discard worker-created files.
    try { rmdirSync(runDirectory) } catch { /* non-empty or already removed */ }
  })
  return { done, cancel }
}

const WORKER_STARTERS: Record<WorkerAgentId, (start: WorkerStart) => WorkerHandle> = {
  claude: startClaudeWorker,
  codex: startCodexWorker,
  gemini: startFileWorker,
  opencode: startFileWorker,
}

export function describeWorkerPolicy(agent: WorkerAgentId, mode: DelegationMode = 'analyze'): string {
  if (agent === 'gemini' || agent === 'opencode') return `${agent} ${mode === 'edit' ? 'file editing' : 'read/search only'}; no shell or further delegation`
  return agent === 'claude'
    ? `Claude ${mode === 'edit' ? 'file editing' : 'analysis'}; MCP and agent delegation disabled`
    : `Codex ${mode === 'edit' ? 'workspace-write' : 'read-only'} sandbox; MCP and agent delegation disabled`
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

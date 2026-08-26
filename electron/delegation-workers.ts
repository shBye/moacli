import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectBinary, executableCommand } from './agent-profiles'

export type WorkerAgentId = 'claude' | 'codex'

export const WORKER_AGENT_IDS: readonly WorkerAgentId[] = ['claude', 'codex']

export interface DelegationRun {
  agent: WorkerAgentId
  prompt: string
  cwd: string
  timeoutMs: number
}

export interface WorkerResult {
  text: string
  detail: string
}

function truncateOutput(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n… (truncated ${value.length - limit} chars)`
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

function runWorkerProcess(
  binary: string,
  args: string[],
  run: DelegationRun,
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  const command = executableCommand(binary, args)
  const finalArgs = command.shell ? command.args.map(quoteForShell) : command.args
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, finalArgs, {
      cwd: run.cwd,
      env: { ...process.env, MOACLI_DELEGATED: '1' },
      shell: command.shell,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killWorkerTree(child.pid)
    }, run.timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code ?? -1, timedOut })
    })
    child.stdin.write(run.prompt, () => child.stdin.end())
  })
}

async function runClaudeWorker(run: DelegationRun): Promise<WorkerResult> {
  const binary = detectBinary('claude')
  if (!binary) throw new Error('Claude Code CLI was not found on this machine')
  const args = ['-p', '--output-format', 'json', '--max-turns', '30']
  const { stdout, stderr, exitCode, timedOut } = await runWorkerProcess(binary, args, run)
  if (timedOut) throw new Error(`Claude worker timed out after ${run.timeoutMs / 1000}s`)
  let parsed: { result?: unknown; is_error?: unknown; subtype?: unknown; session_id?: unknown; total_cost_usd?: unknown } | undefined
  try {
    parsed = JSON.parse(stdout.trim())
  } catch {
    parsed = undefined
  }
  if (!parsed || typeof parsed.result !== 'string') {
    if (exitCode !== 0) {
      throw new Error(`Claude worker exited with code ${exitCode}: ${truncateOutput(stderr.trim() || stdout.trim(), 2000)}`)
    }
    throw new Error(`Claude worker produced unparseable output: ${truncateOutput(stdout.trim(), 2000)}`)
  }
  if (parsed.is_error === true) {
    throw new Error(`Claude worker reported an error (${String(parsed.subtype ?? 'unknown')}): ${truncateOutput(parsed.result, 2000)}`)
  }
  const cost = typeof parsed.total_cost_usd === 'number' ? `$${parsed.total_cost_usd.toFixed(4)}` : 'unknown cost'
  return {
    text: parsed.result,
    detail: `session ${String(parsed.session_id ?? 'unknown')}, ${cost}`,
  }
}

async function runCodexWorker(run: DelegationRun): Promise<WorkerResult> {
  const binary = detectBinary('codex')
  if (!binary) throw new Error('Codex CLI was not found on this machine')
  const lastMessageDirectory = join(tmpdir(), 'moacli', 'delegation')
  mkdirSync(lastMessageDirectory, { recursive: true })
  const lastMessagePath = join(lastMessageDirectory, `codex-${randomUUID()}.txt`)
  const args = ['exec', '--skip-git-repo-check', '--output-last-message', lastMessagePath, '-']
  try {
    const { stdout, stderr, exitCode, timedOut } = await runWorkerProcess(binary, args, run)
    if (timedOut) throw new Error(`Codex worker timed out after ${run.timeoutMs / 1000}s`)
    const lastMessage = existsSync(lastMessagePath) ? readFileSync(lastMessagePath, 'utf8').trim() : ''
    if (exitCode !== 0 && !lastMessage) {
      throw new Error(`Codex worker exited with code ${exitCode}: ${truncateOutput(stderr.trim() || stdout.trim(), 2000)}`)
    }
    if (!lastMessage) throw new Error('Codex worker finished without a final message')
    return { text: lastMessage, detail: `exit code ${exitCode}, sandbox read-only` }
  } finally {
    rmSync(lastMessagePath, { force: true })
  }
}

const WORKER_RUNNERS: Record<WorkerAgentId, (run: DelegationRun) => Promise<WorkerResult>> = {
  claude: runClaudeWorker,
  codex: runCodexWorker,
}

export function listWorkerAgents(): { id: WorkerAgentId; available: boolean; path: string | null }[] {
  return WORKER_AGENT_IDS.map((id) => {
    const path = detectBinary(id)
    return { id, available: Boolean(path), path }
  })
}

export function runDelegation(run: DelegationRun): Promise<WorkerResult> {
  return WORKER_RUNNERS[run.agent](run)
}

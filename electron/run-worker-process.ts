import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { executableCommand } from './agent-profiles'
import type { WorkerStart } from './delegation-workers'

interface ProcessOutcome {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
  cancelled: boolean
}

function quoteForShell(argument: string): string {
  if (!argument) return '""'
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
  delete environment.MOACLI_TOKEN
  delete environment.MOACLI_DELEGATION_TOKEN
  if (account?.configDir && !account.detected) {
    if (start.agent === 'claude') environment.CLAUDE_CONFIG_DIR = account.configDir
    if (start.agent === 'codex') environment.CODEX_HOME = account.configDir
  }
  return environment
}

// Feeds newline-delimited stdout to `onLine` as it arrives; the full stdout is
// still collected for the final result.
export function runWorkerProcess(
  binary: string,
  args: string[],
  start: WorkerStart,
  onLine: (line: string) => void,
  environmentOverrides: NodeJS.ProcessEnv = {},
): { outcome: Promise<ProcessOutcome>; cancel: () => void } {
  const command = executableCommand(binary, args)
  const finalArgs = command.shell ? command.args.map(quoteForShell) : command.args
  let child: ChildProcess | undefined
  let cancelled = false
  const outcome = new Promise<ProcessOutcome>((resolve, reject) => {
    const spawned = spawn(command.file, finalArgs, {
      cwd: start.cwd,
      env: { ...workerEnvironment(start), ...environmentOverrides },
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
    let oversized = false
    const timer = setTimeout(() => {
      timedOut = true
      killWorkerTree(spawned.pid)
    }, start.timeoutMs)
    spawned.stdout?.setEncoding('utf8')
    spawned.stderr?.setEncoding('utf8')
    spawned.stdout?.on('data', (text: string) => {
      stdout = (stdout + text).slice(-2_000_000)
      pendingLine += text
      let newline = pendingLine.indexOf('\n')
      while (newline >= 0) {
        const line = pendingLine.slice(0, newline).trim()
        pendingLine = pendingLine.slice(newline + 1)
        if (line) onLine(line)
        newline = pendingLine.indexOf('\n')
      }
      if (pendingLine.length > 2_000_000) {
        oversized = true
        pendingLine = ''; killWorkerTree(spawned.pid)
        stderr = 'Worker emitted an oversized event';
      }
    })
    spawned.stderr?.on('data', (text: string) => { stderr = (stderr + text).slice(-64_000) })
    spawned.on('error', (error) => {
      if (settled) return
      settled = true
      child = undefined
      clearTimeout(timer)
      reject(error)
    })
    spawned.on('close', (code) => {
      if (settled) return
      settled = true
      child = undefined
      clearTimeout(timer)
      if (pendingLine.trim()) onLine(pendingLine.trim())
      resolve({ stdout, stderr, exitCode: oversized ? -1 : code ?? -1, timedOut, cancelled })
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

import { existsSync, mkdirSync, statSync } from 'node:fs'
import type { WebContents } from 'electron'
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { StartPtyRequest } from './contracts'
import { detectBinary, executableCommand, getProfile } from './agent-profiles'

const MAX_PTY_PROCESSES = 10
const OUTPUT_BATCH_DELAY_MS = 8
const MAX_OUTPUT_BATCH_LENGTH = 64 * 1024

function cleanEnvironment(extra: Record<string, string>, account?: StartPtyRequest['account']): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[key] = value
  }
  const result: Record<string, string> = { ...environment, ...extra, TERM: 'xterm-256color', CLI_AGENT_MANAGER: '1' }
  if (account?.configDir && !account.detected) {
    if (account.agentId === 'claude') result.CLAUDE_CONFIG_DIR = account.configDir
    if (account.agentId === 'codex') result.CODEX_HOME = account.configDir
  }
  return result
}

export class PtyManager {
  private readonly processes = new Map<string, IPty>()
  private readonly pendingOutput = new Map<string, string>()
  private outputTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly getWebContents: () => WebContents | null) {}

  start(request: StartPtyRequest): void {
    if (this.processes.has(request.id)) throw new Error('Session is already running')
    if (this.processes.size >= MAX_PTY_PROCESSES) throw new Error(`At most ${MAX_PTY_PROCESSES} CLI sessions can run at once`)
    if (!existsSync(request.cwd) || !statSync(request.cwd).isDirectory()) {
      throw new Error(`Working directory does not exist: ${request.cwd}`)
    }

    const profile = getProfile(request.agentId)
    if (!profile) throw new Error(`Unknown agent profile: ${request.agentId}`)
    const executable = detectBinary(profile.bin)
    if (!executable) throw new Error(`${profile.label} executable was not found`)

    if (request.account?.configDir) mkdirSync(request.account.configDir, { recursive: true })

    const titleArgs = request.purpose !== 'login' && !request.resumeId && request.title && profile.args_name
      ? profile.args_name.map((argument) => argument.replaceAll('{title}', request.title!))
      : []
    const baseArgs = request.purpose === 'login'
      ? profile.args_login ?? []
      : request.resumeId
        ? profile.args_resume.map((argument) => argument.replaceAll('{id}', request.resumeId!))
        : profile.args_new
    if (!baseArgs.length && (request.purpose === 'login' || request.resumeId)) {
      const action = request.purpose === 'login' ? 'login' : request.resumeId ? 'resume' : 'start'
      throw new Error(`${profile.label} does not expose a supported ${action} command`)
    }
    const command = executableCommand(executable, [...baseArgs, ...titleArgs])
    const instance = pty.spawn(command.file, command.args, {
      name: 'xterm-256color',
      cols: Math.max(20, request.cols),
      rows: Math.max(5, request.rows),
      cwd: request.cwd,
      env: cleanEnvironment(profile.env, request.account),
      useConpty: process.platform === 'win32',
      useConptyDll: process.platform === 'win32',
    } as pty.IPtyForkOptions & { useConpty: boolean; useConptyDll: boolean })

    this.processes.set(request.id, instance)
    instance.onData((data) => {
      this.queueOutput(request.id, data)
    })
    instance.onExit(({ exitCode }) => {
      this.flushOutput(request.id)
      this.processes.delete(request.id)
      this.getWebContents()?.send('pty:exit', { id: request.id, exitCode })
    })
  }

  write(id: string, data: string): void {
    this.processes.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols < 2 || rows < 1) return
    this.processes.get(id)?.resize(cols, rows)
  }

  stop(id: string): void {
    const instance = this.processes.get(id)
    if (!instance) return
    instance.kill()
    this.processes.delete(id)
    this.pendingOutput.delete(id)
  }

  stopAll(): void {
    for (const id of [...this.processes.keys()]) this.stop(id)
    if (this.outputTimer) clearTimeout(this.outputTimer)
    this.outputTimer = undefined
    this.pendingOutput.clear()
  }

  private queueOutput(id: string, data: string): void {
    const output = (this.pendingOutput.get(id) ?? '') + data
    this.pendingOutput.set(id, output)
    if (output.length >= MAX_OUTPUT_BATCH_LENGTH) {
      this.flushOutput(id)
      return
    }
    if (!this.outputTimer) {
      this.outputTimer = setTimeout(() => {
        this.outputTimer = undefined
        for (const pendingId of [...this.pendingOutput.keys()]) this.flushOutput(pendingId)
      }, OUTPUT_BATCH_DELAY_MS)
    }
  }

  private flushOutput(id: string): void {
    const data = this.pendingOutput.get(id)
    if (!data) return
    this.pendingOutput.delete(id)
    this.getWebContents()?.send('pty:data', { id, data })
  }
}

import { existsSync, mkdirSync, statSync } from 'node:fs'
import { MessageChannelMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron'
import { detectBinary, executableCommand, getProfile } from './agent-profiles'
import { AttentionBridge } from './attention-bridge'
import type { StartPtyRequest } from './contracts'
import type { HostToMainMessage, MainToHostMessage, PtySpawnSpec } from './pty-host-protocol'

const MAX_PTY_PROCESSES = 10
const SHUTDOWN_GRACE_MS = 700

export interface PtyLifecycleExitEvent {
  request: StartPtyRequest
  exitCode: number
  intentional: boolean
}

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

// Main-process boundary to the PTY host utility process. Owns the host's
// lifecycle (fork, crash recovery, shutdown), the spawn request/response
// channel, and hands the renderer a direct MessagePort for terminal I/O.
export class PtyHostClient {
  private host: UtilityProcess | null = null
  private hostReady: Promise<void> | null = null
  private nextRequestId = 1
  private readonly pendingSpawns = new Map<number, { resolve: () => void; reject: (error: Error) => void }>()
  private readonly live = new Map<string, StartPtyRequest>()
  private readonly starting = new Set<string>()
  private rendererContents: WebContents | null = null
  private disposed = false

  constructor(
    private readonly modulePath: string,
    private readonly getWebContents: () => WebContents | null,
    private readonly attentionBridge: AttentionBridge,
    private readonly onLifecycleExit?: (event: PtyLifecycleExitEvent) => void,
  ) {}

  get liveSessionCount(): number {
    return this.live.size + this.starting.size
  }

  connectRenderer(contents: WebContents): void {
    if (this.disposed) return
    this.rendererContents = contents
    void this.ensureHost().then(() => this.sendRendererPort(contents)).catch(() => {})
  }

  async start(request: StartPtyRequest): Promise<void> {
    if (this.live.has(request.id) || this.starting.has(request.id)) throw new Error('Session is already running')
    if (this.live.size + this.starting.size >= MAX_PTY_PROCESSES) {
      throw new Error(`At most ${MAX_PTY_PROCESSES} CLI sessions can run at once`)
    }
    if (!existsSync(request.cwd) || !statSync(request.cwd).isDirectory()) {
      throw new Error(`Working directory does not exist: ${request.cwd}`)
    }

    const profile = getProfile(request.agentId)
    if (!profile) throw new Error(`Unknown agent profile: ${request.agentId}`)
    const executable = detectBinary(profile.bin)
    if (!executable) throw new Error(`${profile.label} executable was not found`)

    this.starting.add(request.id)
    try {
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
      const attentionOptions = await this.attentionBridge.prepare(request, profile, executable)
      const command = executableCommand(executable, [...attentionOptions.args, ...baseArgs, ...titleArgs])
      const spec: PtySpawnSpec = {
        id: request.id,
        file: command.file,
        args: command.args,
        cwd: request.cwd,
        env: cleanEnvironment({ ...profile.env, ...attentionOptions.env }, request.account),
        cols: request.cols,
        rows: request.rows,
        scanOsc9: profile.attention_adapter === 'codex-osc9',
      }
      await this.spawnInHost(spec)
      this.live.set(request.id, request)
    } catch (error) {
      this.attentionBridge.release(request.id)
      throw error
    } finally {
      this.starting.delete(request.id)
    }
  }

  stop(id: string): void {
    this.host?.postMessage({ type: 'stop', id } satisfies MainToHostMessage)
  }

  async shutdown(): Promise<void> {
    this.disposed = true
    const host = this.host
    this.host = null
    this.hostReady = null
    this.rendererContents = null
    for (const pending of this.pendingSpawns.values()) pending.reject(new Error('PTY host is shutting down'))
    this.pendingSpawns.clear()
    this.live.clear()
    this.starting.clear()
    if (!host) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        host.kill()
        resolve()
      }, SHUTDOWN_GRACE_MS)
      host.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      host.postMessage({ type: 'shutdown' } satisfies MainToHostMessage)
    })
  }

  private ensureHost(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('PTY host is shut down'))
    if (this.host && this.hostReady) return this.hostReady
    const host = utilityProcess.fork(this.modulePath, [], { serviceName: 'moacli-pty-host' })
    this.host = host
    const ready = new Promise<void>((resolve, reject) => {
      host.on('message', (message: HostToMainMessage) => {
        if (message.type === 'ready') resolve()
        this.handleHostMessage(message)
      })
      host.once('exit', () => reject(new Error('PTY host exited during startup')))
    })
    ready.catch(() => {
      // Rejection is surfaced to whoever awaits ensureHost; this handler only
      // keeps an unused stored promise from raising an unhandled rejection.
    })
    this.hostReady = ready
    host.on('exit', () => this.handleHostExit(host))
    return ready
  }

  private sendRendererPort(contents: WebContents): void {
    if (this.disposed || !this.host || this.rendererContents !== contents || contents.isDestroyed()) return
    const { port1, port2 } = new MessageChannelMain()
    this.host.postMessage({ type: 'renderer-port' } satisfies MainToHostMessage, [port1])
    contents.postMessage('pty-host:port', null, [port2])
  }

  private spawnInHost(spec: PtySpawnSpec): Promise<void> {
    return this.ensureHost().then(() => new Promise<void>((resolve, reject) => {
      const host = this.host
      if (!host) {
        reject(new Error('PTY host is not running'))
        return
      }
      const requestId = this.nextRequestId
      this.nextRequestId += 1
      this.pendingSpawns.set(requestId, { resolve, reject })
      host.postMessage({ type: 'spawn', requestId, spec } satisfies MainToHostMessage)
    }))
  }

  private handleHostMessage(message: HostToMainMessage): void {
    if (message.type === 'spawn-result') {
      const pending = this.pendingSpawns.get(message.requestId)
      this.pendingSpawns.delete(message.requestId)
      if (!pending) return
      if (message.error) pending.reject(new Error(message.error))
      else pending.resolve()
    } else if (message.type === 'exit') {
      const request = this.live.get(message.id)
      this.live.delete(message.id)
      this.attentionBridge.release(message.id)
      if (request) {
        queueMicrotask(() => this.onLifecycleExit?.({ request, exitCode: message.exitCode, intentional: message.intentional }))
      }
    } else if (message.type === 'attention') {
      this.attentionBridge.signalOsc9(message.id, message.reason)
    }
  }

  private handleHostExit(host: UtilityProcess): void {
    if (this.disposed || this.host !== host) return
    this.host = null
    this.hostReady = null
    for (const pending of this.pendingSpawns.values()) pending.reject(new Error('PTY host exited unexpectedly'))
    this.pendingSpawns.clear()
    const crashed = [...this.live.entries()]
    this.live.clear()
    this.starting.clear()
    const contents = this.getWebContents()
    for (const [id, request] of crashed) {
      this.attentionBridge.release(id)
      if (contents && !contents.isDestroyed()) contents.send('pty:exit', { id, exitCode: -1 })
      queueMicrotask(() => this.onLifecycleExit?.({ request, exitCode: -1, intentional: false }))
    }
    // Restart eagerly so the renderer regains a live port and new sessions
    // can start without waiting for the next explicit request.
    if (this.rendererContents && !this.rendererContents.isDestroyed()) {
      this.connectRenderer(this.rendererContents)
    }
  }
}

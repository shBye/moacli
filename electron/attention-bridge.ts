import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { getVersion, isVersionAtLeast } from './agent-profiles'
import type { AgentProfile, StartPtyRequest } from './contracts'
import type { AgentEvent } from '../src/features/sessions/agent-event'
import { claudeAttentionHooks, normalizeClaudeHook, normalizeCodexOsc9, normalizeCodexHook } from './attention-events'
import { AttentionDiagnostics } from './attention-diagnostics'

const MAX_HOOK_BODY_BYTES = 1024 * 1024

export interface AttentionLaunchOptions {
  args: string[]
  env: Record<string, string>
}

export interface AttentionSignal {
  request: StartPtyRequest
  event: AgentEvent
  generation: number
}

interface AttentionRegistration {
  request: StartPtyRequest
  profile: AgentProfile
  generation: number
  settingsPath?: string
  promptId?: string
  retiredPromptIds: string[]
  lastOutcomeKey?: string
  hookSessionId?: string
  lastStructuredKind?: AgentEvent['kind']
}

function emptyLaunchOptions(): AttentionLaunchOptions {
  return { args: [], env: {} }
}

export class AttentionBridge {
  readonly diagnostics = new AttentionDiagnostics()
  private readonly token = randomUUID()
  private readonly registrations = new Map<string, AttentionRegistration>()
  private server: Server | undefined
  private port = 0
  private settingsDirectory = ''

  constructor(private readonly onSignal: (signal: AttentionSignal) => void,
    private readonly installHooks?: (request: StartPtyRequest) => void) {}

  async start(settingsDirectory: string): Promise<void> {
    if (this.server) return
    this.settingsDirectory = settingsDirectory
    mkdirSync(settingsDirectory, { recursive: true })

    const server = createServer((request, response) => this.handleHttpHook(request, response))
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error)
      server.once('error', onError)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError)
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error('Attention hook server did not receive a TCP port'))
          return
        }
        this.port = address.port
        resolve()
      })
    })
    this.server = server
  }

  async prepare(
    request: StartPtyRequest,
    profile: AgentProfile,
    executable: string,
  ): Promise<AttentionLaunchOptions> {
    if (request.purpose === 'login' || !profile.attention_adapter || !profile.attention_min_version) {
      return emptyLaunchOptions()
    }

    const version = await getVersion(profile, executable)
    if (!isVersionAtLeast(version, profile.attention_min_version)) {
      this.diagnostics.record(request.id, 'version-unsupported')
      return emptyLaunchOptions()
    }

    const registration: AttentionRegistration = { request, profile, generation: 0, retiredPromptIds: [] }
    this.registrations.set(request.id, registration)

    try {
      if (profile.attention_adapter === 'codex-osc9') {
        const env: Record<string, string> = {}
        if (this.installHooks && this.port && isVersionAtLeast(version, '0.154.0')) {
          try {
            this.installHooks(request)
            env.MOACLI_CODEX_HOOK_ENDPOINT = `http://127.0.0.1:${this.port}/attention/${this.token}/${encodeURIComponent(request.id)}`
            env.MOACLI_HOOK_EXECUTABLE = process.execPath
            this.diagnostics.record(request.id, 'hooks-installed')
            this.emitSignal(registration, { source: 'codex-hooks', kind: 'attention', name: 'HookSetupRequired' })
          } catch { this.diagnostics.record(request.id, 'hooks-unavailable') }
        }
        return {
          args: [
            '-c', 'tui.notifications=true',
            '-c', 'tui.notification_method="osc9"',
            '-c', 'tui.notification_condition="always"',
          ],
          env,
        }
      }

      if (profile.attention_adapter === 'claude-http' && this.port && this.settingsDirectory) {
        const endpoint = `http://127.0.0.1:${this.port}/attention/${this.token}/${encodeURIComponent(request.id)}`
        const settingsPath = join(this.settingsDirectory, `claude-${request.id}.json`)
        writeFileSync(settingsPath, JSON.stringify(claudeAttentionHooks(endpoint)), 'utf8')
        registration.settingsPath = settingsPath
        return { args: ['--settings', settingsPath], env: {} }
      }
    } catch {
      this.release(request.id)
      return emptyLaunchOptions()
    }

    this.registrations.delete(request.id)
    return emptyLaunchOptions()
  }

  // OSC9 sequences are scanned in the PTY host process; it forwards each
  // decoded notification here for registration and generation bookkeeping.
  signalOsc9(ptyId: string, _reason: string): void {
    this.diagnostics.record(ptyId, 'osc-received')
    const registration = this.registrations.get(ptyId)
    if (registration?.profile.attention_adapter !== 'codex-osc9') return
    if (registration.lastStructuredKind && registration.lastStructuredKind !== 'processing') {
      this.diagnostics.record(ptyId, 'osc-suppressed')
      return
    }
    this.emitSignal(registration, normalizeCodexOsc9())
  }

  release(ptyId: string): void {
    this.diagnostics.record(ptyId, 'released')
    const registration = this.registrations.get(ptyId)
    this.registrations.delete(ptyId)
    if (registration?.settingsPath) rmSync(registration.settingsPath, { force: true })
  }

  dispose(): void {
    for (const ptyId of [...this.registrations.keys()]) this.release(ptyId)
    this.server?.close()
    this.server = undefined
    this.port = 0
  }

  private handleHttpHook(request: IncomingMessage, response: ServerResponse): void {
    const pathParts = request.url?.split('?')[0].split('/').filter(Boolean) ?? []
    const validRoute = request.method === 'POST'
      && pathParts.length === 3
      && pathParts[0] === 'attention'
      && pathParts[1] === this.token
    let ptyId = ''
    try {
      ptyId = validRoute ? decodeURIComponent(pathParts[2]) : ''
    } catch {
      this.respond(response, 400, { error: 'Invalid path' })
      request.resume()
      return
    }
    const registration = this.registrations.get(ptyId)
    if (!registration || !['claude-http', 'codex-osc9'].includes(registration.profile.attention_adapter ?? '')) {
      this.respond(response, 404, { error: 'Not found' })
      request.resume()
      return
    }

    const chunks: string[] = []
    let bodyBytes = 0
    let rejected = false
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      if (rejected) return
      bodyBytes += Buffer.byteLength(chunk, 'utf8')
      if (bodyBytes > MAX_HOOK_BODY_BYTES) {
        rejected = true
        chunks.length = 0
        this.respond(response, 413, { error: 'Payload too large' })
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (rejected) return
      try {
        const payload: unknown = JSON.parse(chunks.join(''))
        const codex = registration.profile.attention_adapter === 'codex-osc9'
        const event = codex ? normalizeCodexHook(payload) : normalizeClaudeHook(payload)
        if (codex && payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const input = payload as Record<string, unknown>
          const sessionId = typeof input.session_id === 'string' && input.session_id.length <= 256 ? input.session_id : undefined
          if (sessionId && !input.agent_id && (input.hook_event_name === 'SessionStart' || input.hook_event_name === 'UserPromptSubmit')) {
            registration.hookSessionId ??= sessionId
          }
          if (!sessionId || input.agent_id || (registration.hookSessionId && registration.hookSessionId !== sessionId)) {
            this.diagnostics.record(registration.request.id, 'hook-ignored')
            this.respond(response, 200, {})
            return
          }
        }
        this.diagnostics.record(registration.request.id, event ? 'hook-received' : 'hook-ignored', event?.name)
        // Observers never approve, deny, or block a tool. Unknown events are
        // acknowledged without treating them as a failed hook.
        this.respond(response, 200, {})
        if (event) queueMicrotask(() => this.emitSignal(registration, event))
      } catch {
        this.respond(response, 400, { error: 'Invalid JSON' })
      }
    })
  }

  private emitSignal(
    registration: AttentionRegistration,
    event: AgentEvent,
  ): void {
    if (this.registrations.get(registration.request.id) !== registration) return
    if (event.promptId && registration.retiredPromptIds.includes(event.promptId)) {
      this.diagnostics.record(registration.request.id, 'stale', event.name)
      return
    }
    if (event.source === 'codex-hooks' && event.promptId && registration.promptId
      && event.name !== 'UserPromptSubmit' && event.promptId !== registration.promptId) {
      this.diagnostics.record(registration.request.id, 'stale', event.name)
      return
    }
    if (event.name === 'UserPromptSubmit') {
      if (registration.promptId && registration.promptId !== event.promptId) {
        registration.retiredPromptIds = [...registration.retiredPromptIds, registration.promptId].slice(-32)
      }
      registration.promptId = event.promptId
      registration.lastOutcomeKey = undefined
    }
    if (event.kind === 'processing') registration.lastOutcomeKey = undefined
    if (event.promptId && (event.kind === 'response_completed' || event.kind === 'response_failed' || event.kind === 'response_interrupted')) {
      const key = `${event.promptId}:${event.kind}:${event.errorCode ?? ''}`
      if (registration.lastOutcomeKey === key) return
      registration.lastOutcomeKey = key
    }
    if (event.source === 'codex-hooks' && event.name !== 'HookSetupRequired' && event.kind !== 'ready') registration.lastStructuredKind = event.kind
    registration.generation += 1
    try {
      this.onSignal({
        request: registration.request,
        event,
        generation: registration.generation,
      })
      this.diagnostics.record(registration.request.id, 'delivered', event.name)
    } catch {
      // Attention delivery must never interrupt PTY input or output.
    }
  }

  private respond(response: ServerResponse, statusCode: number, body: object): void {
    if (response.headersSent) return
    response.writeHead(statusCode, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }
}

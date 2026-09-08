import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { getVersion, isVersionAtLeast } from './agent-profiles'
import type { AgentProfile, StartPtyRequest } from './contracts'
import type { AgentEvent } from '../src/features/sessions/agent-event'
import { claudeAttentionHooks, normalizeClaudeHook, normalizeCodexOsc9 } from './attention-events'

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
}

function emptyLaunchOptions(): AttentionLaunchOptions {
  return { args: [], env: {} }
}

export class AttentionBridge {
  private readonly token = randomUUID()
  private readonly registrations = new Map<string, AttentionRegistration>()
  private server: Server | undefined
  private port = 0
  private settingsDirectory = ''

  constructor(private readonly onSignal: (signal: AttentionSignal) => void) {}

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
    if (!isVersionAtLeast(version, profile.attention_min_version)) return emptyLaunchOptions()

    const registration: AttentionRegistration = { request, profile, generation: 0, retiredPromptIds: [] }
    this.registrations.set(request.id, registration)

    try {
      if (profile.attention_adapter === 'codex-osc9') {
        return {
          args: [
            '-c', 'tui.notifications=true',
            '-c', 'tui.notification_method="osc9"',
            '-c', 'tui.notification_condition="always"',
          ],
          env: {},
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
    const registration = this.registrations.get(ptyId)
    if (registration?.profile.attention_adapter !== 'codex-osc9') return
    this.emitSignal(registration, normalizeCodexOsc9())
  }

  release(ptyId: string): void {
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
    if (!registration || registration.profile.attention_adapter !== 'claude-http') {
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
        const event = normalizeClaudeHook(JSON.parse(chunks.join('')) as unknown)
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
    if (event.promptId && registration.retiredPromptIds.includes(event.promptId)) return
    if (event.name === 'UserPromptSubmit') {
      if (registration.promptId && registration.promptId !== event.promptId) {
        registration.retiredPromptIds = [...registration.retiredPromptIds, registration.promptId].slice(-32)
      }
      registration.promptId = event.promptId
      registration.lastOutcomeKey = undefined
    }
    if (event.promptId && (event.kind === 'response_completed' || event.kind === 'response_failed')) {
      const key = `${event.promptId}:${event.kind}:${event.errorCode ?? ''}`
      if (registration.lastOutcomeKey === key) return
      registration.lastOutcomeKey = key
    }
    registration.generation += 1
    try {
      this.onSignal({
        request: registration.request,
        event,
        generation: registration.generation,
      })
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

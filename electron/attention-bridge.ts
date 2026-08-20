import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { getVersion, isVersionAtLeast } from './agent-profiles'
import type { AgentProfile, StartPtyRequest } from './contracts'

const MAX_HOOK_BODY_BYTES = 64 * 1024
const MAX_OSC_CARRY_LENGTH = 4 * 1024
const OSC9_PREFIX = '\x1b]9;'
const CLAUDE_ATTENTION_EVENTS = new Set(['PermissionRequest', 'Elicitation', 'Stop', 'StopFailure'])

export interface AttentionLaunchOptions {
  args: string[]
  env: Record<string, string>
}

export interface AttentionSignal {
  request: StartPtyRequest
  source: 'claude-http' | 'codex-osc9'
  reason: string
  generation: number
}

interface AttentionRegistration {
  request: StartPtyRequest
  profile: AgentProfile
  generation: number
  settingsPath?: string
}

export interface Osc9ScanResult {
  messages: string[]
  carry: string
}

function emptyLaunchOptions(): AttentionLaunchOptions {
  return { args: [], env: {} }
}

function partialOscPrefix(value: string): string {
  const maximum = Math.min(value.length, OSC9_PREFIX.length - 1)
  for (let length = maximum; length > 0; length -= 1) {
    const suffix = value.slice(-length)
    if (OSC9_PREFIX.startsWith(suffix)) return suffix
  }
  return ''
}

export function scanOsc9(data: string, previousCarry = ''): Osc9ScanResult {
  const combined = `${previousCarry}${data}`
  const messages: string[] = []
  let carry = ''
  let cursor = 0

  while (cursor < combined.length) {
    const start = combined.indexOf(OSC9_PREFIX, cursor)
    if (start < 0) {
      carry = partialOscPrefix(combined.slice(cursor))
      break
    }

    const bodyStart = start + OSC9_PREFIX.length
    const bellEnd = combined.indexOf('\x07', bodyStart)
    const stringEnd = combined.indexOf('\x1b\\', bodyStart)
    const end = bellEnd < 0 ? stringEnd : stringEnd < 0 ? bellEnd : Math.min(bellEnd, stringEnd)
    if (end < 0) {
      const partial = combined.slice(start)
      carry = partial.length <= MAX_OSC_CARRY_LENGTH ? partial : ''
      break
    }

    messages.push(combined.slice(bodyStart, end).trim() || 'terminal-notification')
    cursor = end + (end === bellEnd ? 1 : 2)
  }

  return { messages, carry }
}

export class AttentionBridge {
  private readonly token = randomUUID()
  private readonly registrations = new Map<string, AttentionRegistration>()
  private readonly oscCarry = new Map<string, string>()
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

    const registration: AttentionRegistration = { request, profile, generation: 0 }
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
        const handler = { type: 'http', url: endpoint, timeout: 5 }
        const settingsPath = join(this.settingsDirectory, `claude-${request.id}.json`)
        writeFileSync(settingsPath, JSON.stringify({
          allowedHttpHookUrls: [endpoint],
          hooks: {
            PermissionRequest: [{ matcher: '*', hooks: [handler] }],
            Elicitation: [{ matcher: '*', hooks: [handler] }],
            Stop: [{ hooks: [handler] }],
            StopFailure: [{ hooks: [handler] }],
          },
        }), 'utf8')
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

  observePtyOutput(request: StartPtyRequest, data: string): void {
    const registration = this.registrations.get(request.id)
    if (registration?.profile.attention_adapter !== 'codex-osc9') return

    const result = scanOsc9(data, this.oscCarry.get(request.id))
    if (result.carry) this.oscCarry.set(request.id, result.carry)
    else this.oscCarry.delete(request.id)
    for (const reason of result.messages) this.emitSignal(registration, 'codex-osc9', reason)
  }

  release(ptyId: string): void {
    const registration = this.registrations.get(ptyId)
    this.registrations.delete(ptyId)
    this.oscCarry.delete(ptyId)
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

    let body = ''
    let rejected = false
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      if (rejected) return
      body += chunk
      if (Buffer.byteLength(body, 'utf8') > MAX_HOOK_BODY_BYTES) {
        rejected = true
        this.respond(response, 413, { error: 'Payload too large' })
      }
    })
    request.on('end', () => {
      if (rejected) return
      try {
        const payload = JSON.parse(body) as { hook_event_name?: unknown }
        const reason = typeof payload.hook_event_name === 'string' ? payload.hook_event_name : ''
        if (!CLAUDE_ATTENTION_EVENTS.has(reason)) {
          this.respond(response, 400, { error: 'Unsupported hook event' })
          return
        }
        this.respond(response, 200, {})
        queueMicrotask(() => this.emitSignal(registration, 'claude-http', reason))
      } catch {
        this.respond(response, 400, { error: 'Invalid JSON' })
      }
    })
  }

  private emitSignal(
    registration: AttentionRegistration,
    source: AttentionSignal['source'],
    reason: string,
  ): void {
    registration.generation += 1
    try {
      this.onSignal({
        request: registration.request,
        source,
        reason,
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

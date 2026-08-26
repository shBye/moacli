import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { listWorkerAgents, runDelegation, type DelegationRun } from './delegation-workers'

const MCP_PATH = '/mcp'
const PREFERRED_PORT = 38017
const PORT_SCAN_RANGE = 20
const DEFAULT_TIMEOUT_SECONDS = 300
const MAX_TIMEOUT_SECONDS = 600
const MAX_RESULT_CHARS = 200_000
const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i
const LOCAL_HOST_PATTERN = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i

interface StoredServerConfig {
  port: number
  token: string
}

function log(message: string): void {
  console.log(`[delegation] ${message}`)
}

function truncateResult(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n… (truncated ${value.length - limit} chars)`
}

function portCandidates(preferred: number): number[] {
  return Array.from({ length: PORT_SCAN_RANGE + 1 }, (_, index) => preferred + index)
}

export class DelegationServer {
  private httpServer: HttpServer | null = null
  private token = ''
  private port = 0
  private readonly configPath: string

  constructor(private readonly userDataDirectory: string, private readonly appVersion: string) {
    this.configPath = join(userDataDirectory, 'delegation-server.json')
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}${MCP_PATH}`
  }

  async start(): Promise<void> {
    const stored = this.readStoredConfig()
    this.token = stored?.token ?? randomBytes(24).toString('hex')
    const candidates = stored
      ? [stored.port, ...portCandidates(PREFERRED_PORT).filter((port) => port !== stored.port)]
      : portCandidates(PREFERRED_PORT)
    for (const candidate of candidates) {
      if (await this.tryListen(candidate)) break
    }
    if (!this.httpServer) throw new Error('No local port available for the delegation server')
    this.persistConfig()
    log(`MCP server listening on ${this.url}`)
    log(`Register in Claude Code: claude mcp add --transport http moacli ${this.url} --header "Authorization: Bearer ${this.token}"`)
    log(`Register in Codex (~/.codex/config.toml): [mcp_servers.moacli] url = "${this.url}" http_headers = { "Authorization" = "Bearer ${this.token}" } tool_timeout_sec = ${MAX_TIMEOUT_SECONDS + 30}`)
  }

  dispose(): void {
    this.httpServer?.close()
    this.httpServer = null
  }

  private readStoredConfig(): StoredServerConfig | null {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.configPath, 'utf8'))
      if (
        typeof parsed === 'object' && parsed !== null
        && typeof (parsed as StoredServerConfig).port === 'number'
        && typeof (parsed as StoredServerConfig).token === 'string'
        && (parsed as StoredServerConfig).token.length >= 16
      ) {
        return parsed as StoredServerConfig
      }
    } catch {
      // Missing or corrupt config falls through to a fresh token/port.
    }
    return null
  }

  private persistConfig(): void {
    mkdirSync(this.userDataDirectory, { recursive: true })
    writeFileSync(this.configPath, JSON.stringify({ port: this.port, token: this.token, url: this.url }, null, 2))
  }

  private tryListen(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer((request, response) => { void this.handleRequest(request, response) })
      server.requestTimeout = 0
      server.once('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => {
        this.httpServer = server
        this.port = port
        resolve(true)
      })
    })
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const origin = request.headers.origin
    if (origin && !LOCAL_ORIGIN_PATTERN.test(origin)) return false
    if (!LOCAL_HOST_PATTERN.test(request.headers.host ?? '')) return false
    return (request.headers.authorization ?? '') === `Bearer ${this.token}`
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if ((request.url ?? '').split('?', 1)[0] !== MCP_PATH) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'not found' }))
      return
    }
    if (!this.isAuthorized(request)) {
      log(`Rejected unauthorized ${request.method ?? 'GET'} request`)
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    // Stateless mode: each request gets fresh server+transport instances so any
    // number of CLI clients can talk to the same endpoint without session state.
    const mcpServer = this.buildMcpServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    response.on('close', () => {
      void transport.close()
      void mcpServer.close()
    })
    try {
      await mcpServer.connect(transport)
      await transport.handleRequest(request, response)
    } catch (error) {
      log(`Request handling failed: ${error instanceof Error ? error.message : String(error)}`)
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'internal error' }))
      }
    }
  }

  private buildMcpServer(): McpServer {
    const server = new McpServer({ name: 'moacli', version: this.appVersion })

    server.registerTool('list_agents', {
      description: 'List the CLI coding agents MoaCLI can delegate work to on this machine, with availability.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, () => {
      const agents = listWorkerAgents()
      log(`list_agents → ${agents.filter((agent) => agent.available).map((agent) => agent.id).join(', ') || 'none available'}`)
      return { content: [{ type: 'text', text: JSON.stringify(agents, null, 2) }] }
    })

    server.registerTool('delegate_task', {
      description: [
        'Delegate a self-contained task to another CLI coding agent running headless on this machine and wait for its answer.',
        'The worker runs with conservative permissions (read-oriented; it cannot approve risky actions), so delegate analysis,',
        'reading, and summarization tasks rather than large write operations. Provide the full task in `prompt` —',
        'the worker shares no conversation context with you.',
      ].join(' '),
      // The spawned worker runs read-oriented (Claude default permissions / Codex read-only
      // sandbox), so callers may treat the delegation itself as non-destructive.
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        agent: z.enum(['claude', 'codex']).describe('Which agent executes the task'),
        prompt: z.string().min(1).max(100_000).describe('Complete, self-contained task description'),
        cwd: z.string().optional().describe('Absolute working directory for the task (defaults to the user home directory)'),
        timeout_seconds: z.number().int().min(10).max(MAX_TIMEOUT_SECONDS).optional()
          .describe(`Maximum runtime before the worker is killed (default ${DEFAULT_TIMEOUT_SECONDS})`),
      },
    }, async ({ agent, prompt, cwd, timeout_seconds }) => {
      const run: DelegationRun = {
        agent,
        prompt,
        cwd: cwd && existsSync(cwd) ? cwd : homedir(),
        timeoutMs: (timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
      }
      const startedAt = Date.now()
      log(`delegate_task started: agent=${agent} cwd=${run.cwd} prompt=${truncateResult(prompt.replace(/\s+/g, ' '), 120)}`)
      try {
        const result = await runDelegation(run)
        log(`delegate_task finished: agent=${agent} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s (${result.detail})`)
        return { content: [{ type: 'text' as const, text: truncateResult(result.text, MAX_RESULT_CHARS) }] }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(`delegate_task failed: agent=${agent} — ${message}`)
        return { content: [{ type: 'text' as const, text: `Delegation failed: ${message}` }], isError: true }
      }
    })

    return server
  }
}

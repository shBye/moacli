import { parseDelegationModels, validateModel, type DelegationModels } from '../src/features/delegation/model-policy'
import { randomBytes } from 'node:crypto'
import { AGENT_ROLES, AGENT_ROLE_IDS, roleTaskPrompt, type AgentRoleId } from './agent-roles'
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync, statSync } from 'node:fs'
import { assertRootCaller, type DelegationMode } from './delegation-policy'
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import type { DelegationServerStatus } from './contracts'
import { isFinishedStatus, type DelegationTaskRegistry } from './delegation-tasks'
import { describeWorkerPolicy, listWorkerAgents } from './delegation-workers'
import { DelegationSessionLinks } from './delegation-session-links'
import type { ReviewSource } from './review-contracts'
import type { StartPtyRequest } from './contracts'

const MCP_PATH = '/mcp'
const PREFERRED_PORT = 38017
const PORT_SCAN_RANGE = 20
const DEFAULT_TIMEOUT_SECONDS = 300
const MAX_TIMEOUT_SECONDS = 600
const MAX_RESULT_CHARS = 6000
const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i
const LOCAL_HOST_PATTERN = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i

interface StoredServerConfig {
  defaultModels: DelegationModels
  port: number
  token: string
  enabled: boolean
  autoApprove: boolean
  autoApproveEdits: boolean
}

interface CallerInfo {
  requestInfo?: { headers?: Record<string, string | string[] | undefined> }
}

export interface DelegationServerOptions {
  userDataDirectory: string
  appVersion: string
  registry: DelegationTaskRegistry
  onChanged: () => void
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

function callerLabel(extra: CallerInfo): string {
  const header = extra.requestInfo?.headers?.['user-agent']
  const value = Array.isArray(header) ? header[0] : header
  return (value ?? '').trim().slice(0, 120) || 'MCP client'
}

function textResult(text: string, isError = false): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  return isError ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] }
}

function jsonResult(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return textResult(JSON.stringify(value, null, 2))
}

export class DelegationServer {
  readonly sessionLinks = new DelegationSessionLinks()

  prepareSession(request: StartPtyRequest): string[] {
    return this.enabled && this.httpServer ? this.sessionLinks.prepare(request, this.url) : []
  }
  private httpServer: HttpServer | null = null
  private token = ''
  private port = 0
  private enabled = true
  private defaultModels = parseDelegationModels(undefined)
  private autoApproveEnabled = false
  private autoApproveEditsEnabled = false
  private readonly configPath: string
  private readonly resultsDirectory: string
  private readonly registry: DelegationTaskRegistry
  private readonly appVersion: string
  private readonly onChanged: () => void

  constructor(private readonly options: DelegationServerOptions) {
    this.configPath = join(options.userDataDirectory, 'delegation-server.json')
    this.resultsDirectory = join(options.userDataDirectory, 'delegation-results')
    this.registry = options.registry
    this.appVersion = options.appVersion
    this.onChanged = options.onChanged
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}${MCP_PATH}`
  }

  status(): DelegationServerStatus {
    const running = Boolean(this.httpServer)
    return {
      enabled: this.enabled,
      running,
      defaultModels: { ...this.defaultModels },
      autoApprove: this.autoApproveEnabled,
      autoApproveEdits: this.autoApproveEditsEnabled,
      port: this.port,
      url: running ? this.url : '',
      token: this.token,
      claudeRegisterCommand: running
        ? `claude mcp add --scope user --transport http moacli ${this.url} --header "Authorization: Bearer ${this.token}"`
        : '',
      codexConfigPath: join(homedir(), '.codex', 'config.toml'),
      codexConfigSnippet: running
        ? [
            '[mcp_servers.moacli]',
            `url = "${this.url}"`,
            `http_headers = { "Authorization" = "Bearer ${this.token}" }`,
            `tool_timeout_sec = ${MAX_TIMEOUT_SECONDS + 30}`,
          ].join('\n')
        : '',
    }
  }

  async start(): Promise<void> {
    if (process.env.MOACLI_DELEGATED === '1') throw new Error('A delegated worker cannot start a delegation server')
    const stored = this.readStoredConfig()
    this.token = stored?.token ?? randomBytes(24).toString('hex')
    this.enabled = stored?.enabled ?? true
    this.defaultModels = parseDelegationModels(stored?.defaultModels)
    this.autoApproveEnabled = stored?.autoApprove ?? false
    this.autoApproveEditsEnabled = stored?.autoApproveEdits ?? false
    this.port = stored?.port ?? PREFERRED_PORT
    if (!this.enabled) {
      this.persistConfig()
      log('MCP server is disabled in settings')
      return
    }
    await this.listen(stored?.port)
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled
    if (!enabled) {
      this.httpServer?.close()
      this.httpServer = null
      this.persistConfig()
      log('MCP server stopped from settings')
    } else if (!this.httpServer) {
      await this.listen(this.port)
    }
    this.onChanged()
  }

  defaultModel(agent: string): string {
    if (agent !== 'claude' && agent !== 'codex') throw new Error('Unsupported worker agent')
    return this.defaultModels[agent]
  }

  setDefaultModel(agent: string, model: string): void {
    this.defaultModel(agent)
    const previous = this.defaultModels
    this.defaultModels = { ...previous, [agent]: validateModel(model) }
    try { this.persistConfig() } catch (error) { this.defaultModels = previous; throw error }
    this.onChanged()
  }

  get autoApprove(): boolean {
    return this.autoApproveEnabled
  }

  get autoApproveEdits(): boolean { return this.autoApproveEditsEnabled }

  setAutoApproveEdits(enabled: boolean): void {
    this.autoApproveEditsEnabled = enabled
    this.persistConfig()
    this.onChanged()
  }

  setAutoApprove(enabled: boolean): void {
    this.autoApproveEnabled = enabled
    this.persistConfig()
    log(enabled ? 'Analysis auto-approve enabled' : 'Analysis auto-approve disabled')
    this.onChanged()
  }

  regenerateToken(): void {
    this.sessionLinks.clear()
    this.token = randomBytes(24).toString('hex')
    this.persistConfig()
    log('Bearer token regenerated; previously registered clients must be updated')
    this.onChanged()
  }

  dispose(): void {
    this.sessionLinks.clear()
    this.httpServer?.close()
    this.httpServer = null
  }

  private async listen(preferredPort?: number): Promise<void> {
    // Registered clients embed the URL, so the preferred port always comes
    // first: a stored fallback port (e.g. persisted while a second app
    // instance briefly held the preferred one) heals back on restart.
    const candidates = preferredPort && preferredPort !== PREFERRED_PORT
      ? [PREFERRED_PORT, preferredPort, ...portCandidates(PREFERRED_PORT).filter((port) => port !== preferredPort && port !== PREFERRED_PORT)]
      : portCandidates(PREFERRED_PORT)
    for (const candidate of candidates) {
      if (await this.tryListen(candidate)) break
    }
    if (!this.httpServer) throw new Error('No local port available for the delegation server')
    this.persistConfig()
    log(`MCP server listening on ${this.url}`)
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
        const config = parsed as Partial<StoredServerConfig>
        return { defaultModels: parseDelegationModels(config.defaultModels), port: config.port!, token: config.token!, enabled: config.enabled !== false, autoApprove: config.autoApprove === true, autoApproveEdits: config.autoApproveEdits === true }
      }
    } catch {
      // Missing or corrupt config falls through to a fresh token/port.
    }
    return null
  }

  private persistConfig(): void {
    mkdirSync(this.options.userDataDirectory, { recursive: true })
    writeFileSync(this.configPath, JSON.stringify({ defaultModels: this.defaultModels, port: this.port, token: this.token, url: this.url, enabled: this.enabled, autoApprove: this.autoApproveEnabled, autoApproveEdits: this.autoApproveEditsEnabled }, null, 2))
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
    return (request.headers.authorization ?? '') === `Bearer ${this.token}` || Boolean(this.sessionLinks.resolve(request.headers.authorization))
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.headers['x-moacli-delegation-depth'] && request.headers['x-moacli-delegation-depth'] !== '0') {
      response.writeHead(403, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'Mini agents cannot delegate again' }))
      return
    }
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
    const mcpServer = this.buildMcpServer(this.sessionLinks.resolve(request.headers.authorization))
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

  private buildMcpServer(source?: ReviewSource): McpServer {
    const server = new McpServer({ name: 'moacli', version: this.appVersion })
    const taskInput = {
      role: z.enum(AGENT_ROLE_IDS).optional().describe('Optional role preset. Role and execution mode are independent. Use list_roles for details.'),
      mode: z.enum(['analyze', 'edit']).default('analyze').describe('Default analyze. Edit requests require approval unless the user enabled edit auto-approval; do not edit the same files yourself while the worker runs.'),
      delegation_depth: z.literal(0).optional().describe('Only original CLIs may submit tasks (depth 0). Mini agents must return to the original caller, never submit tasks.'),
      agent: z.enum(['claude', 'codex']).describe('Which agent executes the task'),
      prompt: z.string().min(1).max(100_000).describe('Complete, self-contained task description'),
      cwd: z.string().optional().describe('Absolute working directory for the task (defaults to the user home directory)'),
      timeout_seconds: z.number().int().min(10).max(MAX_TIMEOUT_SECONDS).optional()
        .describe(`Maximum runtime before the worker is killed (default ${DEFAULT_TIMEOUT_SECONDS})`),
    }
    const taskIdInput = { task_id: z.string().min(1).describe('Task id returned by start_task') }
    const describeTask = (taskId: string) => {
      const task = this.registry.get(taskId)
      if (!task) return null
      const reference = task.startedAt ?? task.createdAt
      return {
        task_id: task.id,
        agent: task.agent,
        status: task.status,
        elapsed_seconds: Math.round(((task.finishedAt ?? Date.now()) - reference) / 1000),
        ...(task.error ? { error: task.error } : {}),
        ...(task.detail ? { detail: task.detail } : {}),
      }
    }
    const createTask = (input: { agent: 'claude' | 'codex'; prompt: string; cwd?: string; timeout_seconds?: number; role?: AgentRoleId; mode?: DelegationMode; delegation_depth?: number }, extra: CallerInfo) => {
      assertRootCaller(input.delegation_depth ?? 0)
      if (input.mode === 'edit' && !input.cwd) throw new Error('Edit tasks require an explicit project directory')
      if (input.cwd && !isAbsolute(input.cwd)) throw new Error('The working directory must be an absolute path')
      const cwd = realpathSync(input.cwd || homedir())
      if (!statSync(cwd).isDirectory()) throw new Error('The working directory is not a directory')
      return this.registry.create({
        source,
        callerDepth: input.delegation_depth ?? 0,
        mode: input.mode ?? 'analyze',
        role: input.role,
        agent: input.agent,
        prompt: roleTaskPrompt(input.prompt, input.role),
        cwd,
        timeoutMs: (input.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
        caller: input.role ? `${callerLabel(extra)} · ${input.role}` : callerLabel(extra),
      })
    }

    server.registerTool('list_roles', {
      description: 'List the specialist roles available for delegate_task and start_task. A role defines the task focus; agent selects Claude or Codex, not the role.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, () => jsonResult(AGENT_ROLES.map(({ id, label, description }) => ({ id, label, description }))))

    server.registerTool('list_agents', {
      description: 'List the CLI coding agents MoaCLI can delegate work to on this machine, with availability and the permission policy each worker runs under.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, () => {
      const agents = listWorkerAgents()
      log(`list_agents → ${agents.filter((agent) => agent.available).map((agent) => agent.id).join(', ') || 'none available'}`)
      return jsonResult(agents)
    })

    server.registerTool('delegate_task', {
      description: [
        'Delegate a self-contained task to another CLI coding agent running headless on this machine and wait for its answer.',
        'Keep easy work in the original CLI. Delegate only a bounded task that benefits from another agent.',
        'Default analyze; choose edit explicitly for file changes. Approval follows the user settings for each mode. Workers cannot delegate again.',
        'Provide only necessary context and an explicit scope; workers share no conversation history.',
        'For parallel work use start_task, then wait_task. Results are bounded; get_task_result retrieves more.',
      ].join(' '),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      inputSchema: taskInput,
    }, async (input, extra) => {
      let taskId = ''
      try {
        const task = createTask(input, extra)
        taskId = task.id
        log(`delegate_task ${task.id} awaiting approval: agent=${task.agent} cwd=${task.cwd} prompt=${truncateResult(task.promptPreview.replace(/\s+/g, ' '), 120)}`)
        const finished = await this.registry.waitForFinish(task.id)
        if (finished.status !== 'completed') {
          log(`delegate_task ${task.id} ${finished.status}: ${finished.error ?? ''}`)
          return textResult(`Delegation ${finished.status}: ${finished.error ?? 'no result'}`, true)
        }
        log(`delegate_task ${task.id} finished (${finished.detail ?? ''})`)
        const result = this.registry.result(task.id).text
        return jsonResult({ task_id: task.id, text: result.slice(0, MAX_RESULT_CHARS), total_chars: result.length, next_offset: result.length > MAX_RESULT_CHARS ? MAX_RESULT_CHARS : null })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(`delegate_task ${taskId || 'request'} failed — ${message}`)
        return textResult(`Delegation failed: ${message}`, true)
      }
    })

    server.registerTool('start_task', {
      description: [
        'Start a delegated task on another CLI coding agent and return immediately with a task_id.',
        'Use for independent parallel tasks. Up to 3 run concurrently; approved excess tasks queue (10 open max).',
        'Workers cannot re-delegate. Prefer wait_task to frequent polling, then retrieve only needed output.',
        'Default analyze; edit requires approval unless the user enabled edit auto-approval. Avoid concurrent edits by the original CLI in the same files.',
      ].join(' '),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      inputSchema: taskInput,
    }, (input, extra) => {
      try {
        const task = createTask(input, extra)
        log(`start_task ${task.id} awaiting approval: agent=${task.agent} cwd=${task.cwd}`)
        return jsonResult({
          task_id: task.id,
          status: task.status,
          worker_policy: describeWorkerPolicy(task.agent === 'codex' ? 'codex' : 'claude', task.mode),
          note: 'Use wait_task (up to 30 seconds) instead of frequent polling. The user may need to approve first.',
        })
      } catch (error) {
        return textResult(`Could not start the task: ${error instanceof Error ? error.message : String(error)}`, true)
      }
    })

    server.registerTool('check_task', {
      description: 'Check task status. Log output is opt-in to keep responses small. States include awaiting_approval, queued, running, completed, failed, rejected, cancelled.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: { ...taskIdInput, include_log: z.boolean().default(false) },
    }, ({ task_id, include_log }) => {
      const summary = describeTask(task_id)
      if (!summary) return textResult(`Unknown task: ${task_id}`, true)
      const task = this.registry.get(task_id)!
      return jsonResult({
        ...summary,
        ...(include_log ? { progress: this.registry.logTail(task_id) } : {}),
        ...(task.status === 'completed' ? { result_preview: task.resultPreview ?? '', next: 'Call get_task_result for the full answer.' } : {}),
      })
    })

    server.registerTool('wait_task', {
      description: 'Wait up to 30 seconds for completion without model polling. Returns compact status; retrieve the result separately when finished.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: { ...taskIdInput, timeout_seconds: z.number().int().min(1).max(30).default(30) },
    }, async ({ task_id, timeout_seconds }) => {
      if (!this.registry.get(task_id)) return textResult(`Unknown task: ${task_id}`, true)
      await this.registry.waitForFinish(task_id, timeout_seconds * 1000)
      return jsonResult(describeTask(task_id))
    })

    server.registerTool('get_task_result', {
      description: 'Read a completed result in bounded pages (6000 characters by default). Use next_offset only when you need more context.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: { ...taskIdInput, offset: z.number().int().min(0).default(0), max_chars: z.number().int().min(200).max(20_000).default(MAX_RESULT_CHARS) },
    }, ({ task_id, offset, max_chars }) => {
      const task = this.registry.get(task_id)
      if (!task) return textResult(`Unknown task: ${task_id}`, true)
      if (!isFinishedStatus(task.status)) return textResult(`Task ${task_id} is still ${task.status}; use wait_task until it finishes.`, true)
      if (task.status !== 'completed') return textResult(`Task ${task_id} ${task.status}: ${task.error ?? 'no result'}`, true)
      const { text } = this.registry.result(task_id)
      return jsonResult({ task_id, text: text.slice(offset, offset + max_chars), total_chars: text.length, next_offset: offset + max_chars < text.length ? offset + max_chars : null })
    })

    server.registerTool('cancel_task', {
      description: 'Cancel a delegated task that is awaiting approval, queued, or running.',
      annotations: { openWorldHint: false },
      inputSchema: taskIdInput,
    }, ({ task_id }) => {
      try {
        this.registry.cancel(task_id)
        log(`cancel_task ${task_id}`)
        return jsonResult(describeTask(task_id))
      } catch (error) {
        return textResult(error instanceof Error ? error.message : String(error), true)
      }
    })

    return server
  }
}

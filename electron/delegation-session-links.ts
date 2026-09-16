import { randomBytes } from 'node:crypto'
import type { StartPtyRequest } from './contracts'
import type { ReviewSource } from './review-contracts'

export interface DelegationSessionLaunch {
  prepare: (request: StartPtyRequest) => string[]
  release: (ptyId: string) => void
}

// Ephemeral connection credentials identify a PTY, never a folder or selected tab.
// Credentials are not task metadata and are revoked when the PTY exits.
export class DelegationSessionLinks {
  private readonly registrations = new Map<string, { token: string; source: ReviewSource }>()

  prepare(request: StartPtyRequest, url: string): string[] {
    if (request.purpose === 'login' || !['claude', 'codex'].includes(request.agentId)) return []
    const token = randomBytes(24).toString('hex')
    this.registrations.set(request.id, { token, source: {
      sessionId: request.sessionId, historyKey: request.historyKey ?? '', title: request.title ?? request.agentId, cwd: request.cwd,
    } })
    const authorization = `Bearer ${token}`
    if (request.agentId === 'claude') return ['--mcp-config', JSON.stringify({ mcpServers: {
      moacli: { type: 'http', url, headers: { Authorization: authorization } },
    } })]
    return ['-c', `mcp_servers.moacli={url=${JSON.stringify(url)},http_headers={Authorization=${JSON.stringify(authorization)}},enabled=true,tool_timeout_sec=630}`]
  }

  resolve(authorization: string | undefined): ReviewSource | undefined {
    if (!authorization) return undefined
    for (const entry of this.registrations.values()) {
      if (authorization === `Bearer ${entry.token}`) return { ...entry.source }
    }
    return undefined
  }

  update(source: ReviewSource): void {
    for (const entry of this.registrations.values()) {
      if (entry.source.sessionId !== source.sessionId) continue
      // A later empty/stale renderer update must not erase a native history link.
      entry.source = { ...source, historyKey: entry.source.historyKey || source.historyKey }
    }
  }

  release(ptyId: string): void { this.registrations.delete(ptyId) }
  clear(): void { this.registrations.clear() }
}

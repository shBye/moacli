export type CodexPermissionMode = 'cli-default' | 'full-access'
export interface TerminalPermissions { codex: CodexPermissionMode }
export function parseTerminalPermissions(value: unknown): TerminalPermissions {
  const codex = value && typeof value === 'object' ? (value as { codex?: unknown }).codex : undefined
  return { codex: codex === 'full-access' ? 'full-access' : 'cli-default' }
}
export function codexPermissionArgs(agentId: string, purpose: string | undefined, settings: TerminalPermissions): string[] {
  return agentId === 'codex' && purpose !== 'login' && settings.codex === 'full-access'
    ? ['--dangerously-bypass-approvals-and-sandbox'] : []
}

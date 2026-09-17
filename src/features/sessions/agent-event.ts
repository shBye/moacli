export type AgentEventKind =
  | 'approval_required'
  | 'input_required'
  | 'response_completed'
  | 'response_failed'
  | 'response_interrupted'
  | 'processing'
  | 'ready'
  | 'attention'

export interface AgentEvent {
  kind: AgentEventKind
  source: 'claude-http' | 'codex-osc9' | 'codex-hooks'
  name: string
  promptId?: string
  toolName?: string
  errorCode?: string
}

export function agentEventLabel(event: AgentEvent): string {
  switch (event.kind) {
    case 'approval_required': return event.toolName === 'ExitPlanMode' ? 'Plan approval required' : 'Approval required'
    case 'input_required': return 'Your answer is needed'
    case 'response_completed': return 'Response finished'
    case 'response_failed': return event.errorCode ? `Response failed (${event.errorCode})` : 'Response failed'
    case 'response_interrupted': return 'Response interrupted'
    case 'processing': return 'Processing request'
    case 'ready': return event.name === 'HookSetupRequired' ? 'Status unconfirmed: review MoaCLI entries in /hooks' : 'Ready'
    case 'attention': return event.name === 'HookSetupRequired' ? 'Codex status hooks: review with /hooks' : 'Session needs attention'
  }
}

export function agentEventInteractionState(event: AgentEvent): 'running' | 'processing' | 'needs_attention' {
  if (event.kind === 'processing') return 'processing'
  if (event.kind === 'ready') return 'running'
  if (event.kind === 'response_completed' || event.kind === 'response_failed' || event.kind === 'response_interrupted') return 'running'
  return 'needs_attention'
}

export type AgentEventKind =
  | 'approval_required'
  | 'input_required'
  | 'response_completed'
  | 'response_failed'
  | 'processing'
  | 'attention'

export interface AgentEvent {
  kind: AgentEventKind
  source: 'claude-http' | 'codex-osc9'
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
    case 'processing': return 'Processing request'
    case 'attention': return 'Session needs attention'
  }
}

export function agentEventInteractionState(event: AgentEvent): 'running' | 'processing' | 'needs_attention' {
  if (event.kind === 'processing') return 'processing'
  if (event.kind === 'response_completed' || event.kind === 'response_failed') return 'running'
  return 'needs_attention'
}

import type { AgentEvent } from '../src/features/sessions/agent-event'

const ERROR_CODES = new Set([
  'rate_limit', 'overloaded', 'authentication_failed', 'oauth_org_not_allowed',
  'account_on_hold', 'billing_error', 'invalid_request', 'model_not_found',
  'server_error', 'max_output_tokens', 'unknown',
])

function identifier(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined
}

// Only structured hook fields determine state. Prompts, command arguments,
// transcripts, and free-form notification text never become event types.
export function normalizeClaudeHook(payload: unknown): AgentEvent | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const input = payload as Record<string, unknown>
  if (identifier(input.agent_id)) return null // A child finishing is not the main response finishing.
  const name = identifier(input.hook_event_name)
  if (!name) return null
  const event: AgentEvent = { source: 'claude-http', name, kind: 'attention' }
  const promptId = identifier(input.prompt_id)
  const toolName = identifier(input.tool_name)
  if (promptId) event.promptId = promptId
  if (toolName) event.toolName = toolName
  switch (name) {
    case 'PermissionRequest':
      event.kind = toolName === 'AskUserQuestion' ? 'input_required' : 'approval_required'
      break
    case 'Elicitation': event.kind = 'input_required'; break
    case 'UserPromptSubmit': event.kind = 'processing'; break
    case 'Stop': event.kind = 'response_completed'; break
    case 'StopFailure':
      event.kind = 'response_failed'
      event.errorCode = typeof input.error === 'string' && ERROR_CODES.has(input.error) ? input.error : 'unknown'
      break
    default: return null
  }
  return event
}

export function normalizeCodexOsc9(): AgentEvent {
  // OSC9 carries human-readable text, not a documented event discriminator.
  // In particular, an approval alert must not be interpreted as turn completion.
  return { source: 'codex-osc9', name: 'terminal-notification', kind: 'attention' }
}

export function claudeAttentionHooks(endpoint: string): object {
  const handler = { type: 'http', url: endpoint, timeout: 5 }
  return {
    allowedHttpHookUrls: [endpoint],
    hooks: {
      UserPromptSubmit: [{ hooks: [handler] }],
      PermissionRequest: [{ matcher: '*', hooks: [handler] }],
      Elicitation: [{ matcher: '*', hooks: [handler] }],
      Stop: [{ hooks: [handler] }],
      StopFailure: [{ hooks: [handler] }],
    },
  }
}

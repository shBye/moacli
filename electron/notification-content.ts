import type { AppNotificationType, DelegationTask, StartPtyRequest } from './contracts'
import type { AgentEvent } from '../src/features/sessions/agent-event'
import { agentEventLabel } from '../src/features/sessions/agent-event'
import { AGENT_ROLES } from './agent-roles'

export interface NotificationContent {
  body: string
  context?: string
  preview?: string
  actionHint?: string
}

export function compactNotificationText(value: string | undefined, limit = 200): string {
  const text = (value ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function projectName(cwd?: string): string {
  return compactNotificationText(cwd?.split(/[\\/]/).filter(Boolean).at(-1), 60)
}

export function sessionNotificationContent(request: StartPtyRequest, type: AppNotificationType, event?: AgentEvent, exitCode?: number): NotificationContent {
  const fallback = type === 'failed' ? 'Session failed' : type === 'completed' ? 'Session completed' : 'Session needs attention'
  let body = event ? agentEventLabel(event) : fallback
  if (event?.toolName) body += ` · ${compactNotificationText(event.toolName, 60)}`
  if (exitCode !== undefined) body += ` · Exit code ${exitCode}`
  const actionHint = type === 'approval_required' ? 'Open the CLI to review the permission request.'
    : type === 'input_required' ? 'Open the CLI to answer the question.'
      : type === 'failed' ? 'Open the CLI to inspect the error before retrying.'
        : type === 'needs_attention' ? 'Open the CLI to see what needs attention.' : 'Open the session to read the response.'
  return { body, context: [request.agentId, projectName(request.cwd)].filter(Boolean).join(' · '), actionHint }
}

export function delegatedNotificationContent(task: DelegationTask, event: 'awaiting_approval' | 'completed' | 'failed'): NotificationContent {
  const role = AGENT_ROLES.find((item) => item.id === task.role)?.label ?? 'Agent task'
  const mode = task.mode === 'edit' ? 'File editing' : 'Analysis'
  const elapsed = task.startedAt !== undefined && task.finishedAt !== undefined
    ? `${Math.max(0, Math.round((task.finishedAt - task.startedAt) / 1000))}s` : ''
  const body = event === 'awaiting_approval' ? 'Delegation awaiting approval' : event === 'completed' ? 'Delegated task completed' : 'Delegated task failed'
  return {
    body,
    context: [task.agent, role, mode, elapsed, projectName(task.cwd)].filter(Boolean).join(' · '),
    preview: compactNotificationText(event === 'failed' ? task.error : event === 'completed' ? task.resultPreview : undefined),
    actionHint: event === 'awaiting_approval' ? (task.mode === 'edit' ? 'Review before allowing project file changes.' : 'Review the task and choose an account.')
      : event === 'completed' ? 'Open Tasks to read the full result.' : 'Open Tasks to inspect the failure before retrying.',
  }
}

export function desktopNotificationBody(content: NotificationContent, includePreview: boolean): string {
  return [content.body, content.context, includePreview ? content.preview : undefined, content.actionHint].filter(Boolean).join('\n')
}

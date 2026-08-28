import type { DelegationTask, DelegationTaskStatus } from '../../../electron/contracts'

export function delegationStatusLabel(status: DelegationTaskStatus): string {
  if (status === 'awaiting_approval') return 'Awaiting approval'
  if (status === 'running') return 'Running'
  if (status === 'completed') return 'Completed'
  if (status === 'failed') return 'Failed'
  if (status === 'rejected') return 'Declined'
  return 'Cancelled'
}

export function delegationTimeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function delegationPromptLine(task: DelegationTask, limit = 120): string {
  const compact = task.promptPreview.replace(/\s+/g, ' ').trim()
  return compact.length <= limit ? compact : `${compact.slice(0, limit)}…`
}

export function delegationPolicyLabel(agent: string): string {
  return agent === 'codex'
    ? 'Codex read-only sandbox'
    : 'Claude Code default permissions · cannot approve risky actions · MCP disabled'
}

export function isOpenDelegation(task: DelegationTask): boolean {
  return task.status === 'awaiting_approval' || task.status === 'running'
}

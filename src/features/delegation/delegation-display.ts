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

export function isRetryableDelegation(task: DelegationTask): boolean {
  return task.status === 'failed' || task.status === 'cancelled'
}

export type DelegationFailureKind = 'limit' | 'auth'

// The CLIs report limit/auth failures only as free-form message text, so match
// leniently: this feeds a hint label and never gates behavior.
export function delegationFailureKind(task: DelegationTask): DelegationFailureKind | undefined {
  if (task.status !== 'failed') return undefined
  const text = `${task.error ?? ''} ${task.detail ?? ''}`
  if (/usage limit|rate.?limit|limit reached|quota/i.test(text)) return 'limit'
  if (/401|unauthori[sz]ed|invalid api key|token.*(expired|revoked|used)|refresh.*failed|not logged in|please run.*login|authentication/i.test(text)) return 'auth'
  return undefined
}

export function delegationFailureLabel(kind: DelegationFailureKind): string {
  return kind === 'limit' ? 'Usage limit hit — retry with another account' : 'Sign-in problem — log in again or retry with another account'
}

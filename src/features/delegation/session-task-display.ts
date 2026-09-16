import type { DelegationTask } from '../../../electron/contracts'
import type { ReviewSource } from '../../../electron/review-contracts'

export function taskBelongsToSession(task: DelegationTask, session: { id: string; historyKey?: string }): boolean {
  const source = task.source ?? task.reviewSource
  return Boolean(source && (source.sessionId === session.id || (session.historyKey && source.historyKey === session.historyKey)))
}

export function taskSource(task: DelegationTask): ReviewSource | undefined { return task.source ?? task.reviewSource }

// Ignore unrelated sessions and server settings when deciding whether to refetch.
export function sessionTaskRevision(tasks: readonly DelegationTask[], source: ReviewSource, kind: 'mcp' | 'review'): string {
  return JSON.stringify(tasks.filter((task) => Boolean(kind === 'review' ? task.reviewSource : task.source)
    && taskBelongsToSession(task, { id: source.sessionId, historyKey: source.historyKey }))
    .map((task) => [task.id, task.status, task.startedAt, task.finishedAt, task.error, task.detail, task.accountId, task.model, task.resultPreview])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}

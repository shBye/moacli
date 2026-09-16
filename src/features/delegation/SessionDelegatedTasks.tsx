import { useEffect, useRef, useState } from 'react'
import type { CliAgentApi, DelegationSnapshot, DelegationTask } from '../../../electron/contracts'
import type { ReviewSource } from '../../../electron/review-contracts'
import { AGENT_ROLES } from '../../../electron/agent-roles'
import { TaskResultDetails } from './TaskResultDetails'
import { sessionTaskRevision } from './session-task-display'
import { delegationStatusLabel, isOpenDelegation } from './delegation-display'

interface Props {
  api: CliAgentApi
  source: ReviewSource
  changes: DelegationSnapshot | null
  onReviewApproval: (taskId: string) => void
}

export function SessionDelegatedTasks({ api, source, changes, onReviewApproval }: Props) {
  const [entries, setEntries] = useState<DelegationTask[]>([])
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const taskRevision = sessionTaskRevision(changes?.tasks ?? [], source, 'mcp')
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let live = true
    void api.listSessionTasks(source).then((next) => {
      if (live) { setEntries(next); setError('') }
    }).catch((reason) => { if (live) setError(String(reason)) })
    return () => { live = false }
  }, [api, source.sessionId, source.historyKey, taskRevision, revision])

  return <section className="session-delegated-tasks" aria-label="Tasks delegated by this CLI">
    <h3>Delegated by this CLI</h3>
    <p className="review-muted">MCP tasks from this session appear here automatically. Latest 30 tasks; no conversation is copied.</p>
    {error && <p role="alert" className="review-error">{error}</p>}
    {!entries.length && <p className="review-muted">No linked tasks yet. Automatic linking applies to Claude and Codex sessions started with the MCP server enabled. Restart older CLI sessions to connect them.</p>}
    {entries.map((task) => <article className="review-result" key={task.id}>
      <header className="review-result-heading">
        <div><strong>{AGENT_ROLES.find((role) => role.id === task.role)?.label ?? 'Agent task'} · {delegationStatusLabel(task.status)}</strong>
          <p className="review-muted">{task.agent} · {task.mode === 'edit' ? 'File editing' : 'Analysis'} · {new Date(task.createdAt).toLocaleString()}{task.accountEmail ? ` · ${task.accountEmail}` : ''}</p></div>
        <div className="review-actions">
          {task.status === 'awaiting_approval' && <button className="secondary-button" onClick={() => onReviewApproval(task.id)}>Review request</button>}
          {isOpenDelegation(task) && <button className="secondary-button" onClick={() => {
            void api.cancelDelegation(task.id).then(() => { if (mounted.current) setRevision((value) => value + 1) }).catch((reason) => { if (mounted.current) setError(String(reason)) })
          }}>Cancel task</button>}
        </div>
      </header>
      {task.model !== undefined && <p className="review-muted">Requested model: {task.model || 'CLI default'}</p>}
      <p className="review-path">{task.cwd}</p>
      <details><summary>Task brief</summary><pre className="review-patch">{task.promptPreview}</pre></details>
      {task.error && <p role="alert" className="review-error">{task.error}</p>}
      {task.status === 'queued' && <p className="review-muted">Waiting for a worker slot or another edit in this workspace to finish.</p>}
      {task.status === 'running' && <p className="review-muted">The original CLI remains responsible for integration and verification.</p>}
      {task.status === 'completed' && <TaskResultDetails api={api} taskId={task.id} />}
    </article>)}
  </section>
}

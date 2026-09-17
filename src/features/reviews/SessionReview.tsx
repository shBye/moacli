import { isWorkerAgent, type WorkerModelAgent } from '../delegation/model-policy'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCheck, RefreshCw, X } from 'lucide-react'
import type { AgentAccount, AgentHealth, CliAgentApi, DelegationSnapshot } from '../../../electron/contracts'
import type { ReviewSnapshot, ReviewSource } from '../../../electron/review-contracts'
import { AGENT_ROLES, agentRole, type AgentRoleId } from '../../../electron/agent-roles'
import { SelectBox } from '../../components/SelectBox'
import { MarkdownContent } from '../conversation/MarkdownContent'
import { buildRevisionDraft, parseReviewReport, reviewStatusLabel } from './review-display'
import { useSessionReviews } from './useSessionReviews'
import { SessionDelegatedTasks } from '../delegation/SessionDelegatedTasks'
import './reviews.css'

interface Props {
  source: ReviewSource
  sourceAgent: string
  api: CliAgentApi
  profiles: readonly AgentHealth[]
  accounts: readonly AgentAccount[]
  changes: DelegationSnapshot | null
  canPaste: boolean
  onPaste: (text: string) => void
  onReviewApproval: (taskId: string) => void
}

function message(error: unknown): string {
  return String(error).replace(/^Error: (?:Error invoking remote method '[^']+': )?(?:Error: )?/, '')
}

export function SessionReview({ source, sourceAgent, api, profiles, accounts, changes, canPaste, onPaste, onReviewApproval }: Props) {
  const { entries, error: loadError, refresh } = useSessionReviews(api, source, changes)
  const reviewers = profiles.filter((profile) => profile.available && isWorkerAgent(profile.id))
  const [agent, setAgent] = useState(() => reviewers.find((profile) => profile.id !== sourceAgent)?.id ?? reviewers[0]?.id ?? 'codex')
  const [role, setRole] = useState<AgentRoleId>('reviewer')
  const [accountId, setAccountId] = useState('')
  const [instructions, setInstructions] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const live = useRef(true)
  const requestGeneration = useRef(0)
  useEffect(() => { live.current = true; return () => { live.current = false; requestGeneration.current++ } }, [])
  const entry = entries.find((item) => item.task.id === selectedId) ?? entries[0]
  const report = useMemo(() => parseReviewReport(entry?.result ?? ''), [entry?.result])
  const availableAccounts = accounts.filter((account) => account.agentId === agent)
  useEffect(() => { setAccountId(availableAccounts.find((account) => account.detected)?.id ?? availableAccounts[0]?.id ?? '') }, [agent, accounts])
  useEffect(() => { setSelected(new Set()); setDraft(''); setCopied(false) }, [entry?.task.id])
  const prepare = async (): Promise<void> => {
    const generation = ++requestGeneration.current
    setPreparing(true); setError(''); setSnapshot(null)
    try {
      const next = await api.prepareReview(source.cwd)
      if (live.current && generation === requestGeneration.current) setSnapshot(next)
    } catch (reason) { if (live.current && generation === requestGeneration.current) setError(message(reason)) }
    finally { if (live.current && generation === requestGeneration.current) setPreparing(false) }
  }
  const start = async (): Promise<void> => {
    if (!snapshot || starting) return
    setStarting(true); setError('')
    try {
      const account = availableAccounts.find((item) => item.id === accountId)
      const id = await api.startReview({ snapshotId: snapshot.id, source, agent: agent as WorkerModelAgent, account, instructions, role })
      if (live.current) { setSelectedId(id); setSnapshot(null); refresh() }
    } catch (reason) { if (live.current) setError(message(reason)) }
    finally { if (live.current) setStarting(false) }
  }
  const cancel = async (): Promise<void> => {
    if (!entry) return
    try { await api.cancelDelegation(entry.task.id); if (live.current) refresh() }
    catch (reason) { if (live.current) setError(message(reason)) }
  }
  const showSetup = snapshot !== null || preparing || !entries.length
  return (
    <section className="review-panel" aria-label="Agent tasks">
      <SessionDelegatedTasks api={api} source={source} changes={changes} onReviewApproval={onReviewApproval} />
      <header className="review-heading">
        <div><h2><CheckCheck size={19} /> Analyze Git changes</h2><p>Preview the changes, then run an analysis with another agent. Requires a Git repository with an initial commit and uncommitted changes.</p><p className="review-path">Session folder: {source.cwd}</p></div>
        <button className="secondary-button" disabled={preparing || starting || !reviewers.length} onClick={() => void prepare()}><RefreshCw size={14} />{preparing ? 'Preparing changes…' : 'Preview Git changes'}</button>
      </header>
      {(error || loadError) && <p className="review-error" role="alert">{error || loadError}</p>}
      {showSetup && <section className="review-setup" aria-label="Task setup">
        <div className="role-presets" role="group" aria-label="Task role">{AGENT_ROLES.map((item) => <button key={item.id} type="button" className={role === item.id ? 'selected' : ''} aria-pressed={role === item.id} disabled={starting} onClick={() => setRole(item.id)}><strong>{item.label}</strong><span>{item.description}</span></button>)}</div>
        <div className="review-fields">
          <label>Agent<SelectBox value={agent} options={reviewers.map((profile) => ({ value: profile.id, label: profile.label }))} ariaLabel="Task agent" disabled={starting || !reviewers.length} onChange={setAgent} /></label>
          <label>Account<SelectBox value={accountId} options={availableAccounts.length ? availableAccounts.map((account) => ({ value: account.id, label: account.email || account.configDir })) : [{ value: '', label: 'Default CLI account' }]} ariaLabel="Reviewer account" disabled={starting || availableAccounts.length < 2} onChange={setAccountId} /></label>
        </div>
        {!reviewers.length && <p>Install Claude Code or Codex and refresh the agent list to start a task.</p>}
        <label>Task brief <span className="review-muted">optional</span><textarea value={instructions} maxLength={8000} disabled={starting} onChange={(event) => setInstructions(event.target.value)} placeholder="Describe the problem, intended behavior, or improvement you want. The agent does not share this conversation." rows={3} /></label>
        <p className="review-muted">The agent receives a snapshot of staged, unstaged, and new text files plus your brief. These roles return findings and recommendations; they do not edit your project.</p>
        {snapshot && <>
          <div className="review-snapshot-meta"><strong>{snapshot.files.length} changed files</strong><span>{new Date(snapshot.capturedAt).toLocaleTimeString()} · {snapshot.digest.slice(0, 8)}</span></div>
          <p className="review-path">{snapshot.root}</p>
          <ul className="review-files">{snapshot.files.map((file) => <li key={file}>{file}</li>)}</ul>
          <details><summary>Preview what will be sent</summary><pre className="review-patch">{snapshot.patch}</pre></details>
          <footer className="review-actions"><button className="secondary-button" disabled={starting} onClick={() => setSnapshot(null)}>Dismiss</button><button className="modal-save" disabled={starting || !reviewers.some((profile) => profile.id === agent)} onClick={() => void start()}>{starting ? 'Starting task…' : 'Run analysis'}</button></footer>
        </>}
      </section>}
      {!!entries.length && <div className="review-history"><label>Task history<SelectBox value={entry?.task.id ?? ''} ariaLabel="Task history" onChange={setSelectedId} options={entries.map((item) => ({ value: item.task.id, label: `${new Date(item.task.createdAt).toLocaleString()} · ${agentRole(item.review.role).label} · ${item.task.agent} · ${reviewStatusLabel(item.task.status)}` }))} /></label></div>}
      {entry && <article className="review-result">
        <header className="review-result-heading"><div><strong>{agentRole(entry.review.role).label} · {reviewStatusLabel(entry.task.status)}</strong><p className="review-muted">{entry.task.agent} · {entry.task.accountEmail || 'Default account'} · Snapshot {entry.review.snapshot.digest.slice(0, 8)}</p></div>{(entry.task.status === 'running' || entry.task.status === 'queued') && <button className="secondary-button" onClick={() => void cancel()}>Cancel task</button>}</header>
        <details><summary>Captured changes · {entry.review.snapshot.files.length} files</summary><p className="review-muted">Captured {new Date(entry.review.snapshot.capturedAt).toLocaleString()}. Later edits are not included.</p><pre className="review-patch">{entry.review.snapshot.patch}</pre></details>
          {entry.task.status === 'running' && <p role="status">Working with the captured changes. You can switch tabs while this runs.</p>}
          {entry.task.status === 'queued' && <p role="status">Approved and waiting for an available worker slot. You can switch tabs while this waits.</p>}
        {entry.task.error && <p className="review-error" role="alert">{entry.task.error}</p>}
        {entry.task.status === 'completed' && report && <>
          <MarkdownContent text={report.summary} onOpenExternal={api.openExternal} />
          {!report.findings.length && <p>No action items were reported. Read the summary for context and limitations.</p>}
          {report.findings.map((finding, index) => <div className="review-finding" key={index}>
            <label><input type="checkbox" checked={selected.has(index)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(index); else next.delete(index); return next })} /><strong>{finding.title}</strong></label>
            <code>{finding.location}</code><MarkdownContent text={finding.body} onOpenExternal={api.openExternal} />
          </div>)}
          {!!report.findings.length && <button className="modal-save" disabled={!selected.size} onClick={() => { setDraft(buildRevisionDraft(entry, selected)); setCopied(false) }}>Draft revision request{selected.size ? ` (${selected.size})` : ''}</button>}
        </>}
        {entry.task.status === 'completed' && !report && <><p className="review-muted">The agent returned a plain response. You can read and copy it below.</p><MarkdownContent text={entry.result} onOpenExternal={api.openExternal} /><button className="secondary-button" onClick={() => { setDraft(entry.result); setCopied(false) }}>Use response as draft</button></>}
      </article>}
      {draft && <section className="review-draft" aria-label="Revision request draft"><header className="review-result-heading"><h3>Revision request</h3><button className="icon-button" aria-label="Close draft" onClick={() => setDraft('')}><X size={16} /></button></header><textarea rows={9} value={draft} onChange={(event) => { setDraft(event.target.value); setCopied(false) }} /><p className="review-muted">Check the request before inserting it. Press Enter in the CLI when you are ready to send.</p><footer className="review-actions"><button className="secondary-button" onClick={() => { api.writeTerminalClipboard(draft); setCopied(true) }}>{copied ? 'Copied' : 'Copy draft'}</button><button className="modal-save" disabled={!canPaste || !draft.trim()} title={canPaste ? 'Insert into the original CLI without sending' : 'Open the original CLI and finish any pending interaction first'} onClick={() => onPaste(draft)}>Insert into CLI</button></footer></section>}
    </section>
  )
}

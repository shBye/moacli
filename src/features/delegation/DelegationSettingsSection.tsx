import { useEffect, useState } from 'react'
import { Ban, Check, Copy, RefreshCw } from 'lucide-react'
import type { AgentHealth, DelegationSnapshot, DelegationTask } from '../../../electron/contracts'
import { SettingsToggle } from '../../components/SettingsToggle'
import { delegationPromptLine, delegationStatusLabel, delegationTimeLabel, isOpenDelegation } from './delegation-display'

interface DelegationSettingsSectionProps {
  visible: boolean
  snapshot: DelegationSnapshot | null
  profilesById: ReadonlyMap<string, AgentHealth>
  onToggleEnabled: (enabled: boolean) => void
  onRegenerateToken: () => void
  onReviewTask: (taskId: string) => void
  onCancelTask: (taskId: string) => void
}

const COPIED_RESET_MS = 1600

function maskToken(token: string): string {
  return token.length > 10 ? `${token.slice(0, 6)}…${token.slice(-4)}` : token
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    window.cliAgent.writeTerminalClipboard(text)
  }
}

export function DelegationSettingsSection({
  visible,
  snapshot,
  profilesById,
  onToggleEnabled,
  onRegenerateToken,
  onReviewTask,
  onCancelTask,
}: DelegationSettingsSectionProps) {
  const [copiedKey, setCopiedKey] = useState('')
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
  useEffect(() => {
    if (!copiedKey) return undefined
    const timer = window.setTimeout(() => setCopiedKey(''), COPIED_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [copiedKey])
  useEffect(() => {
    if (!visible) setConfirmRegenerate(false)
  }, [visible])

  const server = snapshot?.server
  const tasks = snapshot?.tasks ?? []
  const available = Boolean(server && (server.running || server.enabled || server.token))
  const copy = (key: string, text: string): void => {
    void copyText(text).then(() => setCopiedKey(key))
  }
  const copyButton = (key: string, text: string, label = 'Copy') => (
    <button className="appearance-reset" disabled={!text} onClick={() => copy(key, text)}>
      {copiedKey === key ? <Check size={13} /> : <Copy size={13} />}{copiedKey === key ? 'Copied' : label}
    </button>
  )

  return (
    <section className="delegation-settings" aria-labelledby="delegation-settings-title" hidden={!visible}>
      <div className="delegation-settings-heading">
        <div>
          <h3 id="delegation-settings-title">Delegation</h3>
          <p>Let Claude Code or Codex hand tasks to another agent through MoaCLI. Every request is approved by you first.</p>
        </div>
        <SettingsToggle label="Enabled" checked={Boolean(server?.enabled)} disabled={!available} onChange={onToggleEnabled} />
      </div>

      <div className="update-version-card">
        <div className="update-version-row">
          <span>Status</span>
          <strong className={server?.running ? 'delegation-running' : ''}>
            {!available ? 'Unavailable' : server?.running ? `Listening on 127.0.0.1:${server.port}` : server?.enabled ? 'Starting…' : 'Stopped'}
          </strong>
        </div>
        <div className="update-version-row">
          <span>Endpoint</span>
          <strong>{server?.url || '—'}</strong>
        </div>
        <div className="update-version-row">
          <span>Token</span>
          <span className="delegation-token">
            <strong title="Only shared with clients you register below">{server?.token ? maskToken(server.token) : '—'}</strong>
            {copyButton('token', server?.token ?? '')}
          </span>
        </div>
      </div>

      <div className="delegation-register">
        <div className="delegation-register-block">
          <div className="delegation-register-title">
            <strong>Claude Code</strong>
            {copyButton('claude', server?.claudeRegisterCommand ?? '', 'Copy command')}
          </div>
          <code>{server?.claudeRegisterCommand || 'Start the server to get the registration command.'}</code>
          <p>Run once in a terminal. Claude Code then sees the <em>moacli</em> tools: <em>delegate_task</em>, <em>start_task</em>, <em>check_task</em>, <em>get_task_result</em>, <em>cancel_task</em>.</p>
        </div>
        <div className="delegation-register-block">
          <div className="delegation-register-title">
            <strong>Codex CLI</strong>
            {copyButton('codex', server?.codexConfigSnippet ?? '', 'Copy snippet')}
          </div>
          <code>{server?.codexConfigSnippet || 'Start the server to get the config snippet.'}</code>
          <p>
            Append to <em>~/.codex/config.toml</em>. <em>tool_timeout_sec</em> is raised because Codex cuts tool calls off after 60 s by default.
            Non-interactive <em>codex exec</em> callers must pass <em>--approve-for-me</em> to be allowed to call MCP tools.
          </p>
        </div>
      </div>

      <div className="delegation-token-actions">
        {confirmRegenerate
          ? (
            <>
              <span>Existing registrations stop working until you update them.</span>
              <button className="secondary-button" onClick={() => setConfirmRegenerate(false)}>Keep token</button>
              <button className="modal-save" onClick={() => { setConfirmRegenerate(false); onRegenerateToken() }}>Regenerate</button>
            </>
          )
          : <button className="appearance-reset" disabled={!available} onClick={() => setConfirmRegenerate(true)}><RefreshCw size={13} />Regenerate token</button>}
      </div>

      <div className="delegation-tasks">
        <h4>Recent tasks</h4>
        {!tasks.length && <p className="delegation-tasks-empty">No delegated tasks yet.</p>}
        {tasks.map((task: DelegationTask) => {
          const profile = profilesById.get(task.agent)
          return (
            <div className={`delegation-task-row ${task.status}`} key={task.id}>
              <span className="delegation-task-status">{delegationStatusLabel(task.status)}</span>
              <span className="delegation-task-copy">
                <strong title={task.promptPreview}>{delegationPromptLine(task)}</strong>
                <small>
                  {profile?.label ?? task.agent}
                  {task.accountEmail ? ` · ${task.accountEmail}` : ''}
                  {` · from ${task.caller}`}
                  {` · ${delegationTimeLabel(task.createdAt)}`}
                  {task.error ? ` · ${task.error}` : ''}
                </small>
              </span>
              {task.status === 'awaiting_approval' && (
                <button className="secondary-button" onClick={() => onReviewTask(task.id)}>Review</button>
              )}
              {isOpenDelegation(task) && (
                <button className="icon-button" title="Cancel task" onClick={() => onCancelTask(task.id)}><Ban size={14} /></button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

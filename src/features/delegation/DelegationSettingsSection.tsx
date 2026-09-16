import { DelegationModelSetting } from './DelegationModelSetting'
import { useEffect, useState } from 'react'
import { Ban, Check, Copy, RefreshCw, RotateCcw } from 'lucide-react'
import type { AgentAccount, AgentHealth, DelegationSnapshot, DelegationTask } from '../../../electron/contracts'
import { SelectBox } from '../../components/SelectBox'
import { SettingsToggle } from '../../components/SettingsToggle'
import { SettingsDescription } from '../../components/SettingsDescription'
import { delegationFailureKind, delegationFailureLabel, delegationPromptLine, delegationStatusLabel, delegationTimeLabel, isOpenDelegation, isRetryableDelegation } from './delegation-display'

interface DelegationSettingsSectionProps {
  onModelChange: (agent: string, model: string) => Promise<void>
  visible: boolean
  snapshot: DelegationSnapshot | null
  profilesById: ReadonlyMap<string, AgentHealth>
  onToggleEnabled: (enabled: boolean) => void
  onToggleAutoApprove: (enabled: boolean) => void
  onToggleAutoApproveEdits: (enabled: boolean) => void
  onRegenerateToken: () => void
  onReviewTask: (taskId: string) => void
  onCancelTask: (taskId: string) => void
  onRetryTask: (taskId: string) => void
  accounts: readonly AgentAccount[]
  fallbackAccounts: Readonly<Record<string, string>>
  onFallbackAccountChange: (agentId: string, accountId: string) => void
}

// The two CLIs that can run as delegation workers today.
const WORKER_AGENTS = ['claude', 'codex'] as const

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
  onModelChange,
  visible,
  snapshot,
  profilesById,
  onToggleEnabled,
  onToggleAutoApprove,
  onToggleAutoApproveEdits,
  onRegenerateToken,
  onReviewTask,
  onCancelTask,
  onRetryTask,
  accounts,
  fallbackAccounts,
  onFallbackAccountChange,
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
          <p>Let your main CLI delegate focused tasks. Mini agents work one level deep and cannot delegate again.</p>
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

      <div className="delegation-auto-approve">
        <SettingsToggle
          label="Auto-approve analysis"
          checked={Boolean(server?.autoApprove)}
          disabled={!available || !server?.enabled}
          onChange={onToggleAutoApprove}
        />
        <p>New analysis tasks start with the default account without an approval dialog.</p>
        <SettingsToggle
          label="Auto-approve file edits"
          checked={Boolean(server?.autoApproveEdits)}
          disabled={!available || !server?.enabled}
          onChange={onToggleAutoApproveEdits}
        />
        <SettingsDescription tone="warning">When enabled, delegated tasks can change project files without asking again. Off by default; edits are never automatically retried.</SettingsDescription>
        <p>These settings apply to new requests only. Up to 3 tasks run at once; edits in overlapping workspaces run one at a time.</p>
      </div>

      <div className="delegation-model-settings">
        <h4>Default worker models</h4>
        <p>Automatic approvals always use these defaults. You can change the model for one task in its approval dialog.</p>
        {WORKER_AGENTS.map(agent => <DelegationModelSetting key={agent} agent={agent}
          value={server?.defaultModels?.[agent] ?? ''} disabled={!available} onSave={onModelChange} />)}
        <p>CLI default reads the selected account's user model setting when available. Otherwise the CLI chooses. Model availability depends on your CLI and account.</p>
      </div>

      <div className="delegation-fallback">
        <strong>Fallback account</strong>
        <p>If an analysis task fails from a usage limit or sign-in problem, MoaCLI retries it once with this account automatically. Edit tasks and snapshot tasks require a new user action. Leave on “None” to be asked instead.</p>
        {WORKER_AGENTS.map((agentId) => {
          const agentAccounts = accounts.filter((account) => account.agentId === agentId)
          const selected = fallbackAccounts[agentId] ?? ''
          return (
            <div className="delegation-fallback-row" key={agentId}>
              <span>{profilesById.get(agentId)?.label ?? agentId}</span>
              {agentAccounts.length
                ? (
                  <SelectBox
                    variant="settings"
                    value={agentAccounts.some((account) => account.id === selected) ? selected : ''}
                    options={[
                      { value: '', label: 'None — ask me first' },
                      ...agentAccounts.map((account) => ({ value: account.id, label: account.email || account.configDir })),
                    ]}
                    ariaLabel={`Fallback account for ${profilesById.get(agentId)?.label ?? agentId}`}
                    onChange={(accountId) => onFallbackAccountChange(agentId, accountId)}
                  />
                )
                : <small>Add accounts in Settings → Accounts first.</small>}
            </div>
          )
        })}
      </div>

      <div className="delegation-register">
        <SettingsDescription>MoaCLI sessions connect automatically. Use the setup below only for external terminals; their tasks appear in the global list.</SettingsDescription>
        <div className="delegation-register-block">
          <div className="delegation-register-title">
            <strong>Claude Code</strong>
            {copyButton('claude', server?.claudeRegisterCommand ?? '', 'Copy command')}
          </div>
          <code>{server?.claudeRegisterCommand || 'Start the server to get the registration command.'}</code>
          <p>Run once in a terminal; <em>--scope user</em> registers it for every project. Claude Code then sees the <em>moacli</em> tools: <em>delegate_task</em>, <em>start_task</em>, <em>check_task</em>, <em>get_task_result</em>, <em>cancel_task</em>.</p>
        </div>
        <div className="delegation-register-block">
          <div className="delegation-register-title">
            <strong>Codex CLI</strong>
            {copyButton('codex', server?.codexConfigSnippet ?? '', 'Copy snippet')}
          </div>
          <code>{server?.codexConfigSnippet || 'Start the server to get the config snippet.'}</code>
          <p>
            Append to <em>{server?.codexConfigPath || '~/.codex/config.toml'}</em>. <em>tool_timeout_sec</em> is raised because Codex cuts tool calls off after 60 s by default.
            Non-interactive <em>codex exec</em> callers must pass <em>--approve-for-me</em> to be allowed to call MCP tools.
          </p>
        </div>
      </div>

      <div className="delegation-token-actions">
        {confirmRegenerate
          ? (
            <>
              <span>Update external registrations and restart open MoaCLI CLI sessions after regenerating the token.</span>
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
          const failureKind = delegationFailureKind(task)
          return (
            <div className={`delegation-task-row ${task.status}`} key={task.id}>
              <span className="delegation-task-status">{delegationStatusLabel(task.status)}</span>
              <span className="delegation-task-copy">
                <strong title={task.promptPreview}>{delegationPromptLine(task)}</strong>
                <small>
                  {profile?.label ?? task.agent}
                  {task.model !== undefined ? ` / Model: ${task.model || 'CLI default'}` : ''}
                  {task.accountEmail ? ` · ${task.accountEmail}` : ''}
                  {` · from ${task.caller}`}
                  {task.retryOfId ? ' · retry' : ''}
                  {` · ${delegationTimeLabel(task.createdAt)}`}
                  {task.error ? ` · ${task.error}` : ''}
                </small>
                {failureKind && <small className="delegation-failure-hint">{delegationFailureLabel(failureKind)}</small>}
              </span>
              {task.status === 'awaiting_approval' && (
                <button className="secondary-button" onClick={() => onReviewTask(task.id)}>Review</button>
              )}
              {isRetryableDelegation(task) && (
                <button className="icon-button" title="Retry with another account" onClick={() => onRetryTask(task.id)}><RotateCcw size={14} /></button>
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

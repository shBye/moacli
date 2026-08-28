import { useEffect, useMemo, useState } from 'react'
import { ShieldCheck, X } from 'lucide-react'
import type { AgentAccount, AgentHealth, DelegationTask } from '../../../electron/contracts'
import { AgentAvatar } from '../../components/AgentAvatar'
import { SelectBox } from '../../components/SelectBox'
import type { AgentIconPreference } from '../agent-icons/types'
import { delegationPolicyLabel } from './delegation-display'

interface DelegationApprovalModalProps {
  task: DelegationTask
  accounts: readonly AgentAccount[]
  profilesById: ReadonlyMap<string, AgentHealth>
  resolvedAgentIcon: (agentId: string) => AgentIconPreference
  busy: boolean
  error: string
  onApprove: (taskId: string, account?: AgentAccount) => void
  onReject: (taskId: string) => void
  onDismiss: () => void
}

const DEFAULT_ACCOUNT = 'default'

export function DelegationApprovalModal({
  task,
  accounts,
  profilesById,
  resolvedAgentIcon,
  busy,
  error,
  onApprove,
  onReject,
  onDismiss,
}: DelegationApprovalModalProps) {
  const profile = profilesById.get(task.agent)
  const agentLabel = profile?.label ?? task.agent
  const preferredAccountId = accounts.find((account) => account.detected)?.id ?? accounts[0]?.id ?? DEFAULT_ACCOUNT
  const [accountId, setAccountId] = useState(preferredAccountId)
  useEffect(() => setAccountId(preferredAccountId), [task.id, preferredAccountId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onDismiss])

  const accountOptions = useMemo(() => [
    ...accounts.map((account) => ({ value: account.id, label: account.email || account.configDir })),
    ...(accounts.length ? [] : [{ value: DEFAULT_ACCOUNT, label: `Default ${agentLabel} account` }]),
  ], [accounts, agentLabel])
  const selectedAccount = accounts.find((account) => account.id === accountId)
  const timeoutMinutes = Math.round(task.timeoutMs / 60_000)

  return (
    <div className="launcher-modal-backdrop delegation-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onDismiss()
    }}>
      <section className="launcher-modal delegation-modal" role="dialog" aria-modal="true" aria-labelledby="delegation-approval-title">
        <button className="icon-button launcher-modal-close" title="Decide later (Esc)" onClick={onDismiss}><X size={15} /></button>
        <header className="delegation-modal-heading">
          <AgentAvatar agentId={task.agent} className="tinted" color={profile?.color ?? '#7e878d'} preference={resolvedAgentIcon(task.agent)} />
          <div>
            <h2 id="delegation-approval-title">Delegation request</h2>
            <p><strong>{task.caller}</strong> wants <strong>{agentLabel}</strong> to run a task on this machine.</p>
          </div>
        </header>
        <pre className="delegation-prompt" aria-label="Task prompt">{task.promptPreview}{task.promptLength > task.promptPreview.length ? '\n…' : ''}</pre>
        <dl className="delegation-meta">
          <dt>Working directory</dt><dd title={task.cwd}>{task.cwd}</dd>
          <dt>Time limit</dt><dd>{timeoutMinutes} min</dd>
          <dt>Permissions</dt><dd><ShieldCheck size={12} />{delegationPolicyLabel(task.agent)}</dd>
          <dt>Account</dt>
          <dd>
            <SelectBox
              value={accountId}
              options={accountOptions}
              ariaLabel={`Account for the ${agentLabel} worker`}
              disabled={busy || accountOptions.length <= 1}
              onChange={setAccountId}
            />
          </dd>
        </dl>
        {error && <p className="delegation-modal-error" role="alert">{error}</p>}
        <footer className="delegation-modal-actions">
          <button className="secondary-button" disabled={busy} onClick={() => onReject(task.id)}>Decline</button>
          <button className="modal-save" disabled={busy} onClick={() => onApprove(task.id, selectedAccount)}>
            {busy ? 'Starting…' : `Allow ${agentLabel}`}
          </button>
        </footer>
      </section>
    </div>
  )
}

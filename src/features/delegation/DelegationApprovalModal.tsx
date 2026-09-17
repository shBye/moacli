import { WorkerModelPicker } from './WorkerModelPicker'
import { validateModel } from './model-policy'
import { useDefaultWorkerModel } from './useDefaultWorkerModel'
import { useEffect, useMemo, useState } from 'react'
import { ShieldAlert, ShieldCheck, X } from 'lucide-react'
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
  getDefaultModel: (agent: string, account?: AgentAccount) => Promise<string>
  onApprove: (taskId: string, account?: AgentAccount, model?: string) => void
  onReject: (taskId: string) => void
  onDismiss: () => void
}

const DEFAULT_ACCOUNT = 'default'

type AccountAuthState = 'checking' | 'ok' | 'expired'

export function DelegationApprovalModal({
  task,
  accounts,
  profilesById,
  resolvedAgentIcon,
  busy,
  error,
  getDefaultModel,
  onApprove,
  onReject,
  onDismiss,
}: DelegationApprovalModalProps) {
  const [customModel, setCustomModel] = useState(false)
  const [model, setModel] = useState('')
  useEffect(() => { setCustomModel(false); setModel('') }, [task.id])
  const profile = profilesById.get(task.agent)
  const agentLabel = profile?.label ?? task.agent
  const preferredAccountId = accounts.find((account) => account.detected)?.id ?? accounts[0]?.id ?? DEFAULT_ACCOUNT
  const [accountId, setAccountId] = useState(preferredAccountId)
  useEffect(() => setAccountId(preferredAccountId), [task.id, preferredAccountId])

  // Probe each account's sign-in when the modal opens: a failed email lookup
  // means the account is logged out or its token expired.
  const [authById, setAuthById] = useState<ReadonlyMap<string, AccountAuthState>>(new Map())
  useEffect(() => {
    let live = true
    setAuthById(new Map(accounts.map((account) => [account.id, 'checking' as AccountAuthState])))
    for (const account of accounts) {
      void window.cliAgent.inspectAccount(account).then((inspected) => {
        if (!live) return
        setAuthById((current) => new Map(current).set(account.id, inspected ? 'ok' : 'expired'))
      }).catch(() => {
        if (!live) return
        setAuthById((current) => new Map(current).set(account.id, 'expired'))
      })
    }
    return () => { live = false }
    // Accounts are read from settings and stable while the modal is up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onDismiss])

  const accountOptions = useMemo(() => [
    ...accounts.map((account) => ({
      value: account.id,
      label: `${account.email || account.configDir}${authById.get(account.id) === 'expired' ? ' — sign-in expired' : ''}`,
    })),
    ...(accounts.length ? [] : [{ value: DEFAULT_ACCOUNT, label: `Default ${agentLabel} account` }]),
  ], [accounts, agentLabel, authById])
  const selectedAccount = accounts.find((account) => account.id === accountId)
  const defaultModel = useDefaultWorkerModel(task.agent, selectedAccount, getDefaultModel, task.id)
  let modelError = ''
  if (customModel) { try { validateModel(model) } catch { modelError = 'Invalid model ID.' } }
  const selectedAuth = selectedAccount ? authById.get(selectedAccount.id) : undefined
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
            <p>
              {task.retryOfId
                ? <>Retrying an earlier task — pick the account <strong>{agentLabel}</strong> should run it with.</>
                : <><strong>{task.caller}</strong> wants <strong>{agentLabel}</strong> to run a task on this machine.</>}
            </p>
          </div>
        </header>
        <pre className="delegation-prompt" aria-label="Task prompt">{task.promptPreview}{task.promptLength > task.promptPreview.length ? '\n…' : ''}</pre>
        <dl className="delegation-meta">
          <dt>Working directory</dt><dd title={task.cwd}>{task.cwd}</dd>
          <dt>Time limit</dt><dd>{timeoutMinutes} min</dd>
          <dt>Permissions</dt><dd><ShieldCheck size={12} />{delegationPolicyLabel(task.agent, task.mode)}</dd>
          {task.mode === 'edit' && <><dt>Editing</dt><dd>This task can change files in the project. Avoid editing the same files in another CLI until it finishes.</dd></>}
          <dt>Model</dt>
          <dd className="delegation-model-choice">
            <SelectBox ariaLabel="Worker model mode" value={customModel ? 'custom' : 'default'} disabled={busy}
              options={[{ value: 'default', label: 'Use default setting' }, { value: 'custom', label: 'Change for this task' }]}
              onChange={value => { setCustomModel(value === 'custom'); if (!model) setModel(defaultModel.model) }} />
            {customModel ? <WorkerModelPicker agent={task.agent} value={model} disabled={busy} account={selectedAccount} onChange={setModel} />
              : <span>{defaultModel.loading ? 'Reading default...' : defaultModel.error || defaultModel.model || 'CLI default (resolved at startup)'}</span>}
            {modelError && <small role="alert">{modelError}</small>}
          </dd>
          <dt>Account</dt>
          <dd>
            <SelectBox
              value={accountId}
              options={accountOptions}
              ariaLabel={`Account for the ${agentLabel} worker`}
              disabled={busy || accountOptions.length <= 1}
              onChange={setAccountId}
            />
            {selectedAuth === 'ok' && <span className="delegation-account-auth ok"><ShieldCheck size={12} />Signed in</span>}
            {selectedAuth === 'expired' && <span className="delegation-account-auth warn"><ShieldAlert size={12} />Sign-in expired — pick another account</span>}
          </dd>
        </dl>
        {error && <p className="delegation-modal-error" role="alert">{error}</p>}
        <footer className="delegation-modal-actions">
          <button className="secondary-button" disabled={busy} onClick={() => onReject(task.id)}>Decline</button>
          <button className="modal-save" disabled={busy || (customModel ? Boolean(modelError) : defaultModel.loading || Boolean(defaultModel.error))} onClick={() => onApprove(task.id, selectedAccount, customModel ? model.trim() : defaultModel.model)}>
            {busy ? 'Starting…' : `Allow ${agentLabel}`}
          </button>
        </footer>
      </section>
    </div>
  )
}

import { LogIn, Plus, Trash2 } from 'lucide-react'
import type { AgentAccount, AgentHealth } from '../../../electron/contracts'
import { AgentAvatar } from '../../components/AgentAvatar'
import { SelectBox } from '../../components/SelectBox'
import type { AgentIconPreference } from '../agent-icons/types'

interface AccountsSettingsSectionProps {
  visible: boolean
  accounts: readonly AgentAccount[]
  profiles: readonly AgentHealth[]
  profilesById: ReadonlyMap<string, AgentHealth>
  resolvedPreference: (agentId: string) => AgentIconPreference
  onChange: (index: number, update: Partial<AgentAccount>) => void
  onAuthenticate: (account: AgentAccount) => void
  onRemove: (index: number) => void
  onAdd: () => void
}

export function AccountsSettingsSection({
  visible,
  accounts,
  profiles,
  profilesById,
  resolvedPreference,
  onChange,
  onAuthenticate,
  onRemove,
  onAdd,
}: AccountsSettingsSectionProps) {
  return (
    <div className="account-fields" hidden={!visible}>
      {accounts.map((account, index) => {
        const profile = profilesById.get(account.agentId)
        return (
          <div className="account-row" key={account.id}>
            <AgentAvatar agentId={account.agentId} className="tinted" color={profile?.color ?? '#7e878d'} preference={resolvedPreference(account.agentId)} />
            <div className="account-inputs">
              <SelectBox
                value={account.agentId}
                options={profiles.filter((item) => item.id !== 'powershell').map((item) => ({ value: item.id, label: item.label }))}
                ariaLabel={`Agent for ${account.email || `account ${index + 1}`}`}
                disabled={account.detected}
                onChange={(agentId) => onChange(index, { agentId })}
              />
              <input type="email" value={account.email} readOnly={account.detected} placeholder="Account email" onChange={(event) => onChange(index, { email: event.target.value })} />
              <input value={account.configDir} readOnly={account.detected} placeholder="Isolated config directory" onChange={(event) => onChange(index, { configDir: event.target.value })} />
            </div>
            <span className={`account-status ${account.detected ? 'verified' : ''}`}>{account.detected ? 'Verified' : 'Fixed'}</span>
            <button className="icon-button" title="Sign in with the official CLI" disabled={!['claude', 'codex'].includes(account.agentId) || !account.email.trim() || !account.configDir.trim()} onClick={() => onAuthenticate(account)}><LogIn size={15} /></button>
            <button className="icon-button" title={account.detected ? 'Auto-detected accounts are managed by the official CLI' : 'Delete account'} disabled={account.detected} onClick={() => onRemove(index)}><Trash2 size={15} /></button>
          </div>
        )
      })}
      <button className="add-account-button" onClick={onAdd}><Plus size={14} />Add account</button>
    </div>
  )
}

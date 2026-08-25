import type { CSSProperties } from 'react'
import { Folder, Play } from 'lucide-react'
import type { AgentAccount, AgentHealth } from '../../../electron/contracts'
import moaCliIcon from '../../assets/moacli-icon.png'
import { AgentAvatar } from '../../components/AgentAvatar'
import type { AgentIconPreference } from '../agent-icons/types'
import type { LogicalFolder } from '../folders/types'

interface SessionLauncherProps {
  profiles: readonly AgentHealth[]
  agentId: string
  agentIcons: Readonly<Record<string, AgentIconPreference>>
  title: string
  cwd: string
  folders: readonly LogicalFolder[]
  folderId: string
  accountId: string
  accounts: readonly AgentAccount[]
  selectedProfile?: AgentHealth
  selectedAccount?: AgentAccount
  onAgentChange: (agentId: string) => void
  onTitleChange: (title: string) => void
  onSelectWorkingDirectory: () => void
  onFolderChange: (folderId: string) => void
  onAccountChange: (accountId: string) => void
  onStart: () => void
  onOpenAccountSettings: () => void
}

export function SessionLauncher({
  profiles,
  agentId,
  agentIcons,
  title,
  cwd,
  folders,
  folderId,
  accountId,
  accounts,
  selectedProfile,
  selectedAccount,
  onAgentChange,
  onTitleChange,
  onSelectWorkingDirectory,
  onFolderChange,
  onAccountChange,
  onStart,
  onOpenAccountSettings,
}: SessionLauncherProps) {
  const startDisabled = !selectedProfile?.available
    || !cwd.trim()
    || (agentId !== 'powershell' && !selectedAccount)
  return (
    <div className="launcher scroll">
      <div className="launcher-inner">
        <div className="launcher-heading">
          <span className="launcher-icon"><img src={moaCliIcon} alt="" draggable={false} /></span>
          <h1>Start a new session</h1>
          <p>Choose an agent and working directory to begin.</p>
        </div>
        <div className="launcher-card">
          <div className="agent-picker" role="radiogroup" aria-label="Select an agent">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                role="radio"
                aria-checked={agentId === profile.id}
                className={agentId === profile.id ? 'active' : ''}
                disabled={!profile.available}
                onClick={() => onAgentChange(profile.id)}
                title={profile.available ? profile.label : `${profile.label} not found`}
              >
                <AgentAvatar
                  agentId={profile.id}
                  className="picker"
                  preference={agentIcons[profile.id] ?? { mode: 'monogram' }}
                />
                <span>{profile.label.replace(' Code', '').replace(' CLI', '')}</span>
              </button>
            ))}
          </div>
          <label className="launcher-field title-field">
            <span>Title</span>
            <input autoFocus maxLength={40} value={title} placeholder="Session title" onChange={(event) => onTitleChange(event.target.value)} />
            <small>{title.length}/40</small>
          </label>
          <button className="launcher-field path-field" onClick={onSelectWorkingDirectory}>
            <Folder size={15} />
            <span>{cwd}</span>
            <strong>Change</strong>
          </button>
          <label className="launcher-field folder-field">
            <Folder size={15} />
            <span>Folder</span>
            <select value={folderId} onChange={(event) => onFolderChange(event.target.value)}>
              <option value="unsorted">Unsorted</option>
              {folders.filter((folder) => folder.id !== 'unsorted').map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>
          </label>
          <label className="launcher-field account-field">
            <span className="account-color" style={{ '--agent': selectedProfile?.color ?? '#7e878d' } as CSSProperties} />
            {agentId === 'powershell' ? (
              <span>Local shell</span>
            ) : accounts.length ? (
              <select value={accountId} onChange={(event) => onAccountChange(event.target.value)}>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.email}</option>)}
              </select>
            ) : (
              <button className="account-setup-link" onClick={onOpenAccountSettings}>
                No account connected yet — set one up
              </button>
            )}
          </label>
        </div>
        <div className="start-row">
          <button className="start-button" onClick={onStart} disabled={startDisabled}>
            <Play size={14} fill="currentColor" /> Start
          </button>
          <kbd>Ctrl↵</kbd>
        </div>
      </div>
    </div>
  )
}

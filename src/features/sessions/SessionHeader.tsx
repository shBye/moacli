import { Bell, BellOff, Check, RefreshCw } from 'lucide-react'
import { AgentAvatar } from '../../components/AgentAvatar'
import type { AgentIconPreference } from '../agent-icons/types'
import { sessionStateLabel } from './session-display'
import type { RuntimeSession } from './types'

interface SessionHeaderProps {
  session: RuntimeSession
  profileColor: string
  iconPreference: AgentIconPreference
  loginRefreshing: boolean
  notificationsEnabled: boolean
  muted: boolean
  onRefreshAccount: () => void
  onToggleMuted: () => void
  onShowCli: () => void
  onShowConversation: () => void
}

export function SessionHeader({
  session,
  profileColor,
  iconPreference,
  loginRefreshing,
  notificationsEnabled,
  muted,
  onRefreshAccount,
  onToggleMuted,
  onShowCli,
  onShowConversation,
}: SessionHeaderProps) {
  const accountVerified = session.statusDetail.startsWith('Verified account:')
  return (
    <header className="session-context">
      <div className="session-summary">
        <AgentAvatar agentId={session.agentId} className="header" color={profileColor} preference={iconPreference} />
        <h1 title={session.title}>{session.title}</h1>
        <span className={`state-chip ${session.state}`} title={session.statusDetail}>
          <span />{sessionStateLabel(session.state)}
        </span>
        {session.account?.email && <span className="session-email">{session.account.email}</span>}
        <span className="session-cwd" title={session.cwd}>{session.cwd}</span>
        {session.purpose === 'login' && (
          <button
            className="icon-button context-account-refresh"
            title={accountVerified ? session.statusDetail : 'Refresh signed-in account'}
            disabled={loginRefreshing}
            onClick={onRefreshAccount}
          >
            {accountVerified
              ? <Check size={15} />
              : <RefreshCw className={loginRefreshing ? 'spinning' : ''} size={15} />}
          </button>
        )}
        {notificationsEnabled && session.purpose === 'session' && (
          <button
            className="icon-button context-notification-mute"
            title={muted ? 'Unmute session notifications' : 'Mute session notifications'}
            aria-pressed={muted}
            onClick={onToggleMuted}
          >
            {muted ? <BellOff size={14} /> : <Bell size={14} />}
          </button>
        )}
      </div>
      <div className="session-subnav">
        <nav className="view-tabs" aria-label="Session views">
          <button className={session.view === 'cli' ? 'active' : ''} onClick={onShowCli}>CLI</button>
          <button
            className={session.view === 'conversation' ? 'active' : ''}
            disabled={!session.historyKey}
            onClick={onShowConversation}
          >
            Conversation {session.conversation?.messages.length ?? ''}
          </button>
        </nav>
      </div>
    </header>
  )
}

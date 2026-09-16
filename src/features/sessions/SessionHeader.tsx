import { Bell, BellOff, Check } from 'lucide-react'
import { AgentAvatar } from '../../components/AgentAvatar'
import type { AgentIconPreference } from '../agent-icons/types'
import { sessionStateLabel } from './session-display'
import type { RuntimeSession } from './types'

interface SessionHeaderProps {
  session: RuntimeSession
  profileColor: string
  iconPreference: AgentIconPreference
  notificationsEnabled: boolean
  muted: boolean
  onToggleMuted: () => void
  onShowCli: () => void
  onShowConversation: () => void
  onShowReview: () => void
  reviewCount: number
}

export function SessionHeader({
  session,
  profileColor,
  iconPreference,
  notificationsEnabled,
  muted,
  onToggleMuted,
  onShowCli,
  onShowConversation,
  onShowReview,
  reviewCount,
}: SessionHeaderProps) {
  return (
    <header className="session-context">
      <div className="session-summary">
        <AgentAvatar agentId={session.agentId} className="header" color={profileColor} preference={iconPreference} />
        <h1 title={session.title}>{session.title}</h1>
        <span className={`state-chip ${session.state}`} title={session.statusDetail}>
          {session.state === 'running' && session.statusDetail === 'Response finished'
            ? <><Check size={12} aria-hidden="true" />Completed</>
            : <><span />{session.state === 'needs_attention' && session.statusDetail === 'Approval required'
              ? 'Approval required' : sessionStateLabel(session.state)}</>}
        </span>
        <span className="session-cwd" title={session.cwd}>{session.cwd}</span>
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
        <nav className="view-tabs" aria-label="Session views" role="tablist">
          <button
            className={session.view === 'cli' ? 'active' : ''}
            type="button"
            role="tab"
            aria-selected={session.view === 'cli'}
            onClick={onShowCli}
          >
            <span className="view-tab-label">CLI</span>
          </button>
          <button
            className={session.view === 'conversation' ? 'active' : ''}
            type="button"
            role="tab"
            aria-selected={session.view === 'conversation'}
            disabled={!session.historyKey}
            onClick={onShowConversation}
          >
            <span className="view-tab-label">Conversation</span>
            {session.conversation && <small>{session.conversation.messages.length}</small>}
          </button>
        {session.purpose === 'session' && session.agentId !== 'powershell' && (
          <button className={session.view === 'review' ? 'active' : ''} type="button" role="tab" aria-selected={session.view === 'review'} onClick={onShowReview}>
            <span className="view-tab-label">Tasks</span>{reviewCount > 0 && <small className="review-tab-count">{reviewCount}</small>}
          </button>
        )}
        </nav>
      </div>
    </header>
  )
}

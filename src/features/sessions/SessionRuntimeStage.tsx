import { lazy, Suspense } from 'react'
import { ConversationView } from '../../history/ConversationView'
import type { RuntimeSession, SessionState } from './types'

const LazyTerminalPane = lazy(() => import('../../terminal/TerminalPane').then((module) => ({ default: module.TerminalPane })))

interface SessionRuntimeStageProps {
  sessions: readonly RuntimeSession[]
  activeSessionId: string
  terminalFontFamily: string
  terminalFontSize: number
  terminalBackground: string
  terminalForeground: string
  cursorColor: string
  statusAwareAgents: ReadonlySet<string>
  onActivity: (sessionId: string) => void
  onStateChange: (sessionId: string, state: SessionState, detail?: string) => void
}

export function SessionRuntimeStage({
  sessions,
  activeSessionId,
  terminalFontFamily,
  terminalFontSize,
  terminalBackground,
  terminalForeground,
  cursorColor,
  statusAwareAgents,
  onActivity,
  onStateChange,
}: SessionRuntimeStageProps) {
  return (
    <div className={`session-view-stage ${sessions.some((session) => session.id === activeSessionId) ? '' : 'dormant'}`}>
      {sessions.map((session) => (
        <div className={`runtime-session ${activeSessionId === session.id ? 'active' : ''}`} key={session.id}>
          <div className={`terminal-view ${session.view === 'cli' ? 'active' : ''}`}>
            {session.terminalEnabled && (
              <Suspense fallback={null}>
                <LazyTerminalPane
                  key={session.terminalRevision}
                  active={activeSessionId === session.id && session.view === 'cli'}
                  sessionId={session.id}
                  agentId={session.agentId}
                  cwd={session.cwd}
                  title={session.title}
                  account={session.account}
                  purpose={session.purpose}
                  resumeId={session.resumeId}
                  revealLatestAt={session.revealLatestAt}
                  fontFamily={terminalFontFamily}
                  fontSize={terminalFontSize}
                  background={terminalBackground}
                  foreground={terminalForeground}
                  cursorColor={cursorColor}
                  activityStatusEnabled={statusAwareAgents.has(session.agentId)}
                  onActivity={() => onActivity(session.id)}
                  onStateChange={(state, detail) => onStateChange(session.id, state, detail)}
                />
              </Suspense>
            )}
            {session.terminalEnabled && (session.state === 'idle' || session.state === 'starting') && (
              <div className="session-starting" role="status" aria-label="Connecting to CLI session">
                <span className="session-starting-bar" />
                <span className="session-starting-label">Connecting to CLI session</span>
              </div>
            )}
          </div>
          <div className={`conversation-tab ${session.view === 'conversation' ? 'active' : ''}`}>
            {activeSessionId === session.id && session.view === 'conversation' && (
              <ConversationView
                conversation={session.conversation}
                loading={session.conversationLoading}
                error={session.conversationError}
                highlightMessageId={session.highlightMessageId}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

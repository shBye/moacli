import { lazy, Suspense } from 'react'
import type { RuntimeSession, SessionState } from './types'

const LazyTerminalPane = lazy(() => import('../../terminal/TerminalPane').then((module) => ({ default: module.TerminalPane })))
const LazyConversationView = lazy(() => import('../conversation/ConversationView').then((module) => ({ default: module.ConversationView })))

interface SessionRuntimeStageProps {
  sessions: readonly RuntimeSession[]
  activeSessionId: string
  terminalFontFamily: string
  terminalFontSize: number
  terminalRenderer: 'dom' | 'webgl'
  terminalBackground: string
  terminalForeground: string
  cursorColor: string
  statusAwareAgents: ReadonlySet<string>
  onOpenExternal: (url: string) => void
  onLoadOlderMessages: (sessionId: string, before: number) => void
  onActivity: (sessionId: string) => void
  onStateChange: (sessionId: string, state: SessionState, detail?: string) => void
}

export function SessionRuntimeStage({
  sessions,
  activeSessionId,
  terminalFontFamily,
  terminalFontSize,
  terminalRenderer,
  terminalBackground,
  terminalForeground,
  cursorColor,
  statusAwareAgents,
  onOpenExternal,
  onLoadOlderMessages,
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
                  renderer={terminalRenderer}
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
              <Suspense fallback={<div className="history-placeholder">Loading conversation</div>}>
                <LazyConversationView
                  conversation={session.conversation}
                  loading={session.conversationLoading}
                  loadingOlder={session.conversationLoadingOlder}
                  error={session.conversationError}
                  highlightMessageId={session.highlightMessageId}
                  onOpenExternal={onOpenExternal}
                  onLoadOlder={(before) => onLoadOlderMessages(session.id, before)}
                />
              </Suspense>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

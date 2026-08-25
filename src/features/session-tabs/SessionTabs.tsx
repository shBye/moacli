import { useEffect, useRef, useState, type DragEvent } from 'react'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { Plus, RefreshCw, X } from 'lucide-react'
import type { AgentHealth, AppNotification, HistorySession } from '../../../electron/contracts'
import { AgentAvatar } from '../../components/AgentAvatar'
import type { AgentIconPreference } from '../agent-icons/types'
import { notificationTypeLabel } from '../notifications/notification-display'
import { NotificationTypeIcon } from '../notifications/NotificationTypeIcon'
import type { RuntimeSession } from '../sessions/types'
import { MOTION_TRANSITIONS } from '../../motion/tokens'
import { reorderByKey, type RelativeEdge } from '../../shared/collections/reorder'
import { canRestartSession, sessionRestartTitle } from './session-tab-policy'

interface DropHint {
  sessionId: string
  edge: RelativeEdge
}

interface SessionTabsProps {
  sessions: readonly RuntimeSession[]
  activeSessionId: string
  profilesById: ReadonlyMap<string, AgentHealth>
  notificationsBySessionId: ReadonlyMap<string, AppNotification>
  historyByKey: ReadonlyMap<string, HistorySession>
  agentIcons: Readonly<Record<string, AgentIconPreference>>
  onActivate: (sessionId: string) => void
  onRestart: (sessionId: string) => void
  onClose: (sessionId: string) => void
  onReorder: (sessions: RuntimeSession[]) => void
  onNewSession: () => void
}

export function SessionTabs({
  sessions,
  activeSessionId,
  profilesById,
  notificationsBySessionId,
  historyByKey,
  agentIcons,
  onActivate,
  onRestart,
  onClose,
  onReorder,
  onNewSession,
}: SessionTabsProps) {
  const draggedIdRef = useRef('')
  const [draggedId, setDraggedId] = useState('')
  const [dropHint, setDropHint] = useState<DropHint | null>(null)
  const [confirmingCloseId, setConfirmingCloseId] = useState('')
  const confirmCloseTimer = useRef<number>()
  useEffect(() => () => window.clearTimeout(confirmCloseTimer.current), [])

  const requestClose = (session: RuntimeSession): void => {
    window.clearTimeout(confirmCloseTimer.current)
    // Closing kills the CLI process: a session that is mid-task asks for a
    // second click before it goes away.
    if (session.state === 'processing' && confirmingCloseId !== session.id) {
      setConfirmingCloseId(session.id)
      confirmCloseTimer.current = window.setTimeout(() => setConfirmingCloseId(''), 2600)
      return
    }
    setConfirmingCloseId('')
    onClose(session.id)
  }

  const finishDrag = (): void => {
    draggedIdRef.current = ''
    setDraggedId('')
    setDropHint(null)
  }
  const startDrag = (event: DragEvent<HTMLDivElement>, sessionId: string): void => {
    if ((event.target as HTMLElement).closest('.session-tab-actions')) {
      event.preventDefault()
      return
    }
    draggedIdRef.current = sessionId
    setDraggedId(sessionId)
    setDropHint(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-moacli-session-tab', sessionId)
    event.dataTransfer.setData('text/plain', sessionId)
  }
  const dragOver = (event: DragEvent<HTMLDivElement>, targetId: string): void => {
    const draggedSessionId = draggedIdRef.current
    if (!draggedSessionId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (draggedSessionId === targetId) {
      setDropHint(null)
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    const edge: RelativeEdge = event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after'
    setDropHint((current) => current?.sessionId === targetId && current.edge === edge
      ? current
      : { sessionId: targetId, edge })
    const next = reorderByKey(sessions, draggedSessionId, targetId, edge, (session) => session.id)
    if (next.some((session, index) => session.id !== sessions[index]?.id)) onReorder(next)
  }

  return (
    <nav className="session-tabs scroll" role="tablist" aria-label="Open sessions">
      <AnimatePresence initial={false} mode="popLayout">
        {sessions.map((session) => {
          const profile = profilesById.get(session.agentId)
          const sessionNotification = notificationsBySessionId.get(session.id)
          const historyResumeId = historyByKey.get(session.historyKey)?.resumeId ?? ''
          const canRestart = canRestartSession(session, historyResumeId)
          const restartTitle = sessionRestartTitle(session, canRestart)
          const tabDropClass = dropHint?.sessionId === session.id ? `drop-${dropHint.edge}` : ''
          const isDragging = draggedId === session.id
          return (
            <m.div
              layout="position"
              className={`session-tab ${activeSessionId === session.id ? 'active' : ''} ${session.state} ${isDragging ? 'dragging' : ''} ${tabDropClass}`}
              draggable
              aria-grabbed={isDragging}
              key={session.id}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: isDragging ? 0.88 : 1, y: isDragging ? -3 : 0, scale: isDragging ? 1.015 : 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{
                ...MOTION_TRANSITIONS.default,
                layout: MOTION_TRANSITIONS.layout,
                opacity: MOTION_TRANSITIONS.exit,
              }}
              onDragStartCapture={(event) => startDrag(event, session.id)}
              onDragOver={(event) => dragOver(event, session.id)}
              onDrop={(event) => {
                event.preventDefault()
                finishDrag()
              }}
              onDragEndCapture={finishDrag}
            >
              {activeSessionId === session.id && (
                <m.span className="session-tab-active-indicator" layoutId="active-session-tab-indicator" />
              )}
              <button
                className="session-tab-select"
                role="tab"
                aria-selected={activeSessionId === session.id}
                title={`${session.title}\n${session.cwd}`}
                onClick={() => onActivate(session.id)}
              >
                <AgentAvatar
                  agentId={session.agentId}
                  className="tinted"
                  color={profile?.color ?? '#7e878d'}
                  preference={agentIcons[session.agentId] ?? { mode: 'monogram' }}
                />
                <span className={`state-dot ${session.state}`} />
                <span className="session-tab-title">{session.title}</span>
              </button>
              <div className="session-tab-trailing">
                {sessionNotification && (
                  <span className={`session-tab-notification ${sessionNotification.type}`} title={notificationTypeLabel(sessionNotification)}>
                    <NotificationTypeIcon notification={sessionNotification} size={11} />
                  </span>
                )}
                <div className="session-tab-actions">
                  <button className="session-tab-action" title={restartTitle} disabled={!canRestart} onClick={() => onRestart(session.id)}>
                    <RefreshCw className={session.state === 'starting' ? 'spinning' : ''} size={12} />
                  </button>
                  <button
                    className={`session-tab-action close ${confirmingCloseId === session.id ? 'confirming' : ''}`}
                    title={confirmingCloseId === session.id ? 'Session is still working — click again to close' : 'Close session'}
                    onClick={() => requestClose(session)}
                  ><X size={13} /></button>
                </div>
              </div>
            </m.div>
          )
        })}
      </AnimatePresence>
      <button className="session-tab-add" title="New session" aria-label="Start a new session" onClick={onNewSession}>
        <Plus size={14} />
      </button>
    </nav>
  )
}

import type { RuntimeSession } from '../sessions/types'

export function canRestartSession(session: RuntimeSession, historyResumeId: string): boolean {
  return session.state !== 'starting' && (
    session.purpose !== 'session'
    || session.agentId === 'powershell'
    || Boolean(session.resumeId || historyResumeId)
  )
}

export function sessionRestartTitle(session: RuntimeSession, canRestart: boolean): string {
  if (canRestart) return 'Restart CLI session (clears terminal scrollback and unsent input)'
  if (session.state === 'starting') return 'CLI session is starting'
  return 'Waiting for a resumable conversation ID'
}

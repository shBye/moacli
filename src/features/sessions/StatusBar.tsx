import { Download } from 'lucide-react'
import type { AppUpdateInfo } from '../../../electron/contracts'
import { sessionStateLabel } from './session-display'
import { SessionClock } from './SessionClock'
import type { RuntimeSession } from './types'

interface StatusBarProps {
  activeSession?: RuntimeSession
  activeProfileVersion?: string | null
  openSessionCount: number
  maximumSessionCount: number
  update: AppUpdateInfo | null
  updateOpening: boolean
  detectedVersions: string
  getLastActivityAt: () => number
  onOpenUpdate: () => void
}

export function StatusBar({
  activeSession,
  activeProfileVersion,
  openSessionCount,
  maximumSessionCount,
  update,
  updateOpening,
  detectedVersions,
  getLastActivityAt,
  onOpenUpdate,
}: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span className={`status-pill ${activeSession?.state ?? 'idle'}`}>
        <span className="status-dot" />{sessionStateLabel(activeSession?.state ?? 'idle')}
      </span>
      <span>{activeSession ? activeProfileVersion ?? activeSession.agentId : 'No session'}</span>
      <span>{openSessionCount}/{maximumSessionCount} open</span>
      {update?.updateAvailable && (
        <button
          className="status-update"
          disabled={updateOpening}
          title={`Download MoaCLI v${update.latestVersion}`}
          onClick={onOpenUpdate}
        ><Download size={11} />v{update.latestVersion} available</button>
      )}
      <span className="status-right">
        {activeSession
          ? <SessionClock session={activeSession} getLastActivityAt={getLastActivityAt} />
          : detectedVersions}
      </span>
    </footer>
  )
}

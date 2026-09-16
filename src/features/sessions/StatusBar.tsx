import { Check, Download, RefreshCw } from 'lucide-react'
import type { AppUpdateInfo } from '../../../electron/contracts'
import { sessionStateLabel } from './session-display'
import { SessionClock } from './SessionClock'
import type { RuntimeSession } from './types'

interface StatusBarProps {
  diagnosticsBusy: boolean
  diagnosticsMessage: string
  onSaveDiagnostics: () => void
  activeSession?: RuntimeSession
  loginRefreshing: boolean
  onRefreshAccount: () => void
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
  diagnosticsBusy, diagnosticsMessage, onSaveDiagnostics,
  activeSession,
  activeProfileVersion,
  loginRefreshing,
  onRefreshAccount,
  openSessionCount,
  maximumSessionCount,
  update,
  updateOpening,
  detectedVersions,
  getLastActivityAt,
  onOpenUpdate,
}: StatusBarProps) {
  const accountVerified = activeSession?.statusDetail.startsWith('Verified account:') ?? false
  const email = activeSession?.account?.email
  return (
    <footer className="status-bar">
      <span className={`status-pill ${activeSession?.state ?? 'idle'}`}>
        <span className="status-dot" />{sessionStateLabel(activeSession?.state ?? 'idle')}
      </span>
      <span className="status-cli-version" title={activeProfileVersion ?? activeSession?.agentId}>{activeSession ? activeProfileVersion ?? activeSession.agentId : 'No session'}</span>
      {(email || activeSession?.purpose === 'login') && (
        <div className="status-account" aria-label="Current session account">
          <span className="status-account-label">Account</span>
          <span className="status-account-email" title={email || 'Not signed in'}>{email || 'Not signed in'}</span>
          {activeSession?.purpose === 'login' && (
            <button
              className="status-account-refresh"
              title={accountVerified ? activeSession.statusDetail : 'Refresh signed-in account'}
              aria-label={accountVerified ? activeSession.statusDetail : 'Refresh signed-in account'}
              disabled={loginRefreshing}
              onClick={onRefreshAccount}
            >
              {accountVerified ? <Check size={12} /> : <RefreshCw className={loginRefreshing ? 'spinning' : ''} size={12} />}
            </button>
          )}
        </div>
      )}
      <span>{openSessionCount}/{maximumSessionCount} open</span>
      {update?.updateAvailable && (
        <button
          className="status-update"
          disabled={updateOpening}
          title={`Download MoaCLI v${update.latestVersion}`}
          onClick={onOpenUpdate}
        ><Download size={11} />v{update.latestVersion} available</button>
      )}
      <button className="status-diagnostics" disabled={diagnosticsBusy} onClick={onSaveDiagnostics}
        title={diagnosticsMessage || 'Scroll diagnostics are recording. Save after a jump; no conversation or command text is included.'}>
        {diagnosticsBusy ? 'Saving...' : 'Save diagnostics'}
      </button>
      {diagnosticsMessage && <span className="status-diagnostics-message" role="status" title={diagnosticsMessage}>{diagnosticsMessage}</span>}
      <span className="status-right">
        {activeSession
          ? <SessionClock session={activeSession} getLastActivityAt={getLastActivityAt} />
          : detectedVersions}
      </span>
    </footer>
  )
}

import { Download, RefreshCw } from 'lucide-react'
import type { AppUpdateInfo } from '../../../electron/contracts'

interface UpdateSettingsSectionProps {
  visible: boolean
  appVersion: string
  update: AppUpdateInfo | null
  checking: boolean
  opening: boolean
  error: string
  onCheck: () => void
  onOpenDownload: () => void
}

export function UpdateSettingsSection({
  visible,
  appVersion,
  update,
  checking,
  opening,
  error,
  onCheck,
  onOpenDownload,
}: UpdateSettingsSectionProps) {
  return (
    <section className="update-settings" aria-labelledby="update-settings-title" hidden={!visible}>
      <div className="update-settings-heading">
        <div>
          <h3 id="update-settings-title">App updates</h3>
          <p>Check GitHub Releases for a newer MoaCLI installer.</p>
        </div>
        <button className="appearance-reset" disabled={checking} onClick={onCheck}>
          <RefreshCw className={checking ? 'spinning' : ''} size={13} />{checking ? 'Checking' : 'Check again'}
        </button>
      </div>
      <div className="update-version-card">
        <div className="update-version-row">
          <span>Installed</span>
          <strong>{appVersion ? `v${appVersion}` : 'Loading...'}</strong>
        </div>
        <div className="update-version-row">
          <span>Latest release</span>
          <strong>{update ? `v${update.latestVersion}` : 'Not checked'}</strong>
        </div>
        <div className={`update-state ${update?.updateAvailable ? 'available' : ''} ${error ? 'error' : ''}`}>
          {checking
            ? 'Checking for updates...'
            : error
              ? `Update check failed: ${error}`
              : update?.updateAvailable
                ? `MoaCLI v${update.latestVersion} is ready to download.`
                : update
                  ? 'You are using the latest release.'
                  : 'Updates are checked automatically after launch.'}
        </div>
      </div>
      {update?.updateAvailable && (
        <button className="update-download" disabled={opening} onClick={onOpenDownload}>
          <Download size={14} />{opening ? 'Opening download...' : `Download v${update.latestVersion}`}
        </button>
      )}
      <p className="update-note">
        The installer opens in your browser and does not interrupt running sessions. Because this build is unsigned, Windows SmartScreen may ask you to confirm it.
      </p>
    </section>
  )
}

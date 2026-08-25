import { Check, TriangleAlert } from 'lucide-react'
import type { AgentHealth, NotificationSettings } from '../../../electron/contracts'
import { SettingsToggle } from '../../components/SettingsToggle'

interface NotificationSettingsSectionProps {
  visible: boolean
  settings: NotificationSettings
  profiles: readonly AgentHealth[]
  onChange: (update: Partial<NotificationSettings>) => void
}

export function NotificationSettingsSection({
  visible,
  settings,
  profiles,
  onChange,
}: NotificationSettingsSectionProps) {
  return (
    <section className="notification-settings" aria-labelledby="notification-settings-title" hidden={!visible}>
      <div className="notification-settings-heading">
        <h3 id="notification-settings-title">Notifications</h3>
        <SettingsToggle label="Enabled" checked={settings.enabled} onChange={(enabled) => onChange({ enabled })} />
      </div>
      <div className="notification-settings-options">
        <SettingsToggle label="Desktop notifications" checked={settings.desktopEnabled} disabled={!settings.enabled} onChange={(desktopEnabled) => onChange({ desktopEnabled })} />
        <SettingsToggle label="Needs attention" checked={settings.needsAttention} disabled={!settings.enabled} onChange={(needsAttention) => onChange({ needsAttention })} />
        <SettingsToggle label="Failed" checked={settings.failed} disabled={!settings.enabled} onChange={(failed) => onChange({ failed })} />
        <SettingsToggle label="Completed" checked={settings.completed} disabled={!settings.enabled} onChange={(completed) => onChange({ completed })} />
      </div>
      <div className="attention-compatibility" aria-label="Needs attention compatibility">
        {profiles.filter((profile) => profile.attention.minimumVersion).map((profile) => {
          const status = profile.attention.status
          const needsUpdate = status === 'update_required'
          const ready = status === 'supported'
          return (
            <div className={`attention-compatibility-row ${ready ? 'ready' : 'warning'}`} key={profile.id}>
              <span>{profile.label}</span>
              <span title={profile.version ?? 'Version unavailable'}>
                {ready ? <Check size={12} /> : <TriangleAlert size={12} />}
                {ready
                  ? `Ready · v${profile.attention.minimumVersion}+`
                  : needsUpdate
                    ? `Update to v${profile.attention.minimumVersion} or newer`
                    : `Version check required · v${profile.attention.minimumVersion}+`}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

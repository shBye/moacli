import type { MouseEvent as ReactMouseEvent } from 'react'
import { ImagePlus, Shapes } from 'lucide-react'
import type { AgentHealth } from '../../../electron/contracts'
import { AgentAvatar } from '../../components/AgentAvatar'
import { DynamicLucideIcon } from '../../components/DynamicLucideIcon'
import type { LucideIconName } from '../../icons/LucideIconBrowser'
import { agentMonogram } from '../agent-icons/agent-icon'
import type { AgentIconPreference } from '../agent-icons/types'

interface AgentIconSettingsSectionProps {
  visible: boolean
  profiles: readonly AgentHealth[]
  preferences: Readonly<Record<string, AgentIconPreference>>
  resolvedPreference: (agentId: string) => AgentIconPreference
  onChange: (agentId: string, preference: AgentIconPreference) => void
  onOpenIconPicker: (agentId: string) => void
  onImport: (agentId: string, file?: File) => void
  onOpenColorPicker: (event: ReactMouseEvent<HTMLButtonElement>, agentId: string, color: string) => void
}

export function AgentIconSettingsSection({
  visible,
  profiles,
  preferences,
  resolvedPreference,
  onChange,
  onOpenIconPicker,
  onImport,
  onOpenColorPicker,
}: AgentIconSettingsSectionProps) {
  return (
    <section className="agent-icon-settings" aria-labelledby="agent-icon-settings-title" hidden={!visible}>
      <h3 id="agent-icon-settings-title">Agent icons</h3>
      {profiles.map((profile) => {
        const preference = preferences[profile.id]
        const mode = preference?.mode ?? 'monogram'
        return (
          <div className="agent-icon-row" key={profile.id}>
            <div className="agent-icon-identity">
              <AgentAvatar agentId={profile.id} className="tinted" color={profile.color} preference={resolvedPreference(profile.id)} />
              <span>{profile.label}</span>
            </div>
            <div className="agent-icon-controls">
              <div className="agent-icon-choices" role="radiogroup" aria-label={`${profile.label} icon`}>
                <button className={mode === 'monogram' ? 'active' : ''} role="radio" aria-checked={mode === 'monogram'} title="Default monogram" onClick={() => onChange(profile.id, { mode: 'monogram' })}>
                  <span>{agentMonogram(profile.id)}</span>
                </button>
                <button className={mode === 'lucide' ? 'active' : ''} role="radio" aria-checked={mode === 'lucide'} title="Choose a Lucide icon" onClick={() => onOpenIconPicker(profile.id)}>
                  {mode === 'lucide' && preference?.iconName
                    ? <DynamicLucideIcon name={preference.iconName as LucideIconName} size={14} />
                    : <Shapes size={14} />}
                </button>
                <label className={`agent-icon-upload ${mode === 'custom' ? 'active' : ''}`} role="radio" aria-checked={mode === 'custom'} title="Choose a custom image">
                  <ImagePlus size={14} />
                  <input
                    type="file"
                    aria-label={`Choose a custom image for ${profile.label}`}
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => {
                      onImport(profile.id, event.target.files?.[0])
                      event.target.value = ''
                    }}
                  />
                </label>
              </div>
              <button
                className="agent-background-picker"
                title="Icon background color"
                aria-label={`Choose an icon background color for ${profile.label}`}
                aria-haspopup="dialog"
                onClick={(event) => onOpenColorPicker(event, profile.id, preference?.backgroundColor ?? profile.color)}
              >
                <span style={{ background: preference?.backgroundColor ?? profile.color }} />
              </button>
            </div>
          </div>
        )
      })}
    </section>
  )
}

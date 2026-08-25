import { RefreshCw } from 'lucide-react'
import type { AgentHealth } from '../../../electron/contracts'
import { AgentAvatar } from '../../components/AgentAvatar'
import { SectionHeading } from '../../components/SectionHeading'
import type { AgentIconPreference } from '../agent-icons/types'

interface SidebarAgentsSectionProps {
  open: boolean
  profiles: readonly AgentHealth[]
  refreshing: boolean
  resolvedAgentIcon: (agentId: string) => AgentIconPreference
  onToggle: () => void
  onRefresh: () => void
}

export function SidebarAgentsSection({
  open,
  profiles,
  refreshing,
  resolvedAgentIcon,
  onToggle,
  onRefresh,
}: SidebarAgentsSectionProps) {
  return (
    <div className="agent-section">
      <SectionHeading
        label="Agents"
        count={`${profiles.filter((profile) => profile.available).length}/${profiles.length}`}
        open={open}
        onToggle={onToggle}
        actions={<button className="mini-icon-button" title="Refresh CLI versions" disabled={refreshing} onClick={onRefresh}><RefreshCw size={13} /></button>}
      />
      {open && profiles.map((profile) => (
        <div className="health-row" key={profile.id} title={profile.resolvedPath ?? 'Not found'}>
          <AgentAvatar agentId={profile.id} className="neutral" preference={resolvedAgentIcon(profile.id)} />
          <span>{profile.label}</span>
          <small className={!profile.available ? 'error' : ''}>{profile.available ? profile.version ?? 'detected' : 'not found'}</small>
        </div>
      ))}
    </div>
  )
}

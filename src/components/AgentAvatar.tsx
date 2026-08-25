import type { CSSProperties, ReactNode } from 'react'
import { agentMonogram, contrastColor } from '../features/agent-icons/agent-icon'
import type { AgentIconPreference } from '../features/agent-icons/types'
import { DynamicLucideIcon } from './DynamicLucideIcon'

interface AgentAvatarProps {
  agentId: string
  className: string
  color?: string
  preference?: AgentIconPreference
}

export function AgentAvatar({ agentId, className, color, preference }: AgentAvatarProps) {
  const mode = preference?.mode ?? 'monogram'
  const backgroundColor = preference?.backgroundColor
  const style = {
    ...(color ? { '--agent': color } : {}),
    ...(backgroundColor ? { '--agent-bg': backgroundColor, '--agent-ink': contrastColor(backgroundColor) } : {}),
  } as CSSProperties
  let content: ReactNode = <span>{agentMonogram(agentId)}</span>
  if (mode === 'lucide' && preference?.iconName) content = <DynamicLucideIcon name={preference.iconName} />
  else if (mode === 'custom' && preference?.dataUrl) content = <img src={preference.dataUrl} alt="" draggable={false} />
  return <span className={`agent-monogram ${className} icon-${mode} ${backgroundColor ? 'custom-background' : ''}`} style={style}>{content}</span>
}

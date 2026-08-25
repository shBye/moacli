import type { LucideIconName } from '../../icons/LucideIconBrowser'

export type AgentIconMode = 'monogram' | 'lucide' | 'custom'

export interface AgentIconPreference {
  mode: AgentIconMode
  iconName?: LucideIconName
  dataUrl?: string
  backgroundColor?: string
}

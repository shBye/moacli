import type { ReactNode } from 'react'
import './settings-description.css'

export function SettingsDescription({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warning' }) {
  return <p className={`settings-description settings-description-${tone}`}>{children}</p>
}

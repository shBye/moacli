export type SettingsSection = 'terminal' | 'appearance' | 'updates' | 'notifications' | 'delegation' | 'icons' | 'accounts'

export interface AccountSaveNotice {
  kind: 'success' | 'error'
  text: string
}

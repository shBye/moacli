export type SettingsSection = 'appearance' | 'updates' | 'notifications' | 'icons' | 'accounts'

export interface AccountSaveNotice {
  kind: 'success' | 'error'
  text: string
}

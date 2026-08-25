import type { MouseEvent as ReactMouseEvent } from 'react'
import { Bell, Download, LogIn, Palette, Shapes, X } from 'lucide-react'
import type {
  AgentAccount,
  AgentHealth,
  AppUpdateInfo,
  NotificationSettings,
} from '../../../electron/contracts'
import type { AccentTheme, AppearancePreferences } from '../../appearance'
import type { AgentIconPreference } from '../agent-icons/types'
import { AccountsSettingsSection } from './AccountsSettingsSection'
import { AgentIconSettingsSection } from './AgentIconSettingsSection'
import { AppearanceSettingsSection } from './AppearanceSettingsSection'
import { NotificationSettingsSection } from './NotificationSettingsSection'
import type { AccountSaveNotice, SettingsSection } from './types'
import { UpdateSettingsSection } from './UpdateSettingsSection'

interface SettingsModalProps {
  section: SettingsSection
  theme: AccentTheme
  appearance: AppearancePreferences
  maximumTabs: number
  minimumTabs: number
  maximumTabsLimit: number
  localFonts: readonly string[]
  localFontStatus: string
  appVersion: string
  update: AppUpdateInfo | null
  updateChecking: boolean
  updateOpening: boolean
  updateError: string
  notificationSettings: NotificationSettings
  profiles: readonly AgentHealth[]
  profilesById: ReadonlyMap<string, AgentHealth>
  agentIcons: Readonly<Record<string, AgentIconPreference>>
  draftAccounts: readonly AgentAccount[]
  accountSaveNotice: AccountSaveNotice | null
  resolvedAgentIcon: (agentId: string) => AgentIconPreference
  onClose: () => void
  onSectionChange: (section: SettingsSection) => void
  onThemeChange: (theme: AccentTheme) => void
  onAppearanceChange: (update: Partial<AppearancePreferences>) => void
  onResetAppearance: () => void
  onMaximumTabsChange: (value: number) => void
  onDiscoverLocalFonts: () => void
  onCheckUpdate: () => void
  onOpenUpdateDownload: () => void
  onNotificationSettingsChange: (update: Partial<NotificationSettings>) => void
  onAgentIconChange: (agentId: string, preference: AgentIconPreference) => void
  onOpenIconPicker: (agentId: string) => void
  onImportAgentIcon: (agentId: string, file?: File) => void
  onOpenAgentColorPicker: (event: ReactMouseEvent<HTMLButtonElement>, agentId: string, color: string) => void
  onAccountChange: (index: number, update: Partial<AgentAccount>) => void
  onAuthenticateAccount: (account: AgentAccount) => void
  onRemoveAccount: (index: number) => void
  onAddAccount: () => void
  onSaveAccounts: () => void
}

export function SettingsModal({
  section,
  theme,
  appearance,
  maximumTabs,
  minimumTabs,
  maximumTabsLimit,
  localFonts,
  localFontStatus,
  appVersion,
  update,
  updateChecking,
  updateOpening,
  updateError,
  notificationSettings,
  profiles,
  profilesById,
  agentIcons,
  draftAccounts,
  accountSaveNotice,
  resolvedAgentIcon,
  onClose,
  onSectionChange,
  onThemeChange,
  onAppearanceChange,
  onResetAppearance,
  onMaximumTabsChange,
  onDiscoverLocalFonts,
  onCheckUpdate,
  onOpenUpdateDownload,
  onNotificationSettingsChange,
  onAgentIconChange,
  onOpenIconPicker,
  onImportAgentIcon,
  onOpenAgentColorPicker,
  onAccountChange,
  onAuthenticateAccount,
  onRemoveAccount,
  onAddAccount,
  onSaveAccounts,
}: SettingsModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="account-settings-title">
        <header>
          <div><h2 id="account-settings-title">Settings</h2><p>Manage the interface, updates, notifications, and agent accounts.</p></div>
          <button className="icon-button" title="Close" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            <button className={section === 'appearance' ? 'active' : ''} onClick={() => onSectionChange('appearance')}><Palette size={15} />Appearance</button>
            <button className={section === 'updates' ? 'active' : ''} onClick={() => onSectionChange('updates')}><Download size={15} />Updates</button>
            <button className={section === 'notifications' ? 'active' : ''} onClick={() => onSectionChange('notifications')}><Bell size={15} />Notifications</button>
            <button className={section === 'icons' ? 'active' : ''} onClick={() => onSectionChange('icons')}><Shapes size={15} />Agent icons</button>
            <button className={section === 'accounts' ? 'active' : ''} onClick={() => onSectionChange('accounts')}><LogIn size={15} />Accounts</button>
            <div className="settings-app-version" aria-label={`MoaCLI version ${appVersion || 'loading'}`}>
              <span>MoaCLI</span>
              <small>{appVersion ? `v${appVersion}` : 'Loading version...'}</small>
            </div>
          </nav>
          <div className="settings-content scroll">
            <AppearanceSettingsSection
              visible={section === 'appearance'}
              theme={theme}
              appearance={appearance}
              maximumTabs={maximumTabs}
              minimumTabs={minimumTabs}
              maximumTabsLimit={maximumTabsLimit}
              localFonts={localFonts}
              localFontStatus={localFontStatus}
              onThemeChange={onThemeChange}
              onAppearanceChange={onAppearanceChange}
              onMaximumTabsChange={onMaximumTabsChange}
              onDiscoverLocalFonts={onDiscoverLocalFonts}
              onReset={onResetAppearance}
            />
            <UpdateSettingsSection
              visible={section === 'updates'}
              appVersion={appVersion}
              update={update}
              checking={updateChecking}
              opening={updateOpening}
              error={updateError}
              onCheck={onCheckUpdate}
              onOpenDownload={onOpenUpdateDownload}
            />
            <NotificationSettingsSection
              visible={section === 'notifications'}
              settings={notificationSettings}
              profiles={profiles}
              onChange={onNotificationSettingsChange}
            />
            <AgentIconSettingsSection
              visible={section === 'icons'}
              profiles={profiles}
              preferences={agentIcons}
              resolvedPreference={resolvedAgentIcon}
              onChange={onAgentIconChange}
              onOpenIconPicker={onOpenIconPicker}
              onImport={onImportAgentIcon}
              onOpenColorPicker={onOpenAgentColorPicker}
            />
            <AccountsSettingsSection
              visible={section === 'accounts'}
              accounts={draftAccounts}
              profiles={profiles}
              profilesById={profilesById}
              resolvedPreference={resolvedAgentIcon}
              onChange={onAccountChange}
              onAuthenticate={onAuthenticateAccount}
              onRemove={onRemoveAccount}
              onAdd={onAddAccount}
            />
          </div>
        </div>
        <footer>
          {section === 'accounts' && accountSaveNotice && <span className={`account-save-notice ${accountSaveNotice.kind}`}>{accountSaveNotice.text}</span>}
          <button className="secondary-button" onClick={onClose}>Close</button>
          {section === 'accounts' && <button className="modal-save" onClick={onSaveAccounts}>Save</button>}
        </footer>
      </section>
    </div>
  )
}

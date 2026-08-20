import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type LazyExoticComponent,
  type ReactNode,
} from 'react'
import {
  Activity,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  ImagePlus,
  LogIn,
  Minus,
  Palette,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Shapes,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import dynamicIconImports from 'lucide-react/dynamicIconImports'
import moaCliIcon from './assets/moacli-icon.png'
import type { AgentAccount, AgentHealth, AppNotification, ConversationHistory, HistorySession, NotificationSettings, NotificationSnapshot } from '../electron/contracts'
import {
  ACCENT_OPTIONS,
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE,
  TERMINAL_FONT_OPTIONS,
  UI_FONT_OPTIONS,
  loadAppearance,
  saveAppearance,
  terminalFontFamily,
  uiFontFamily,
  type AppearancePreferences,
  type AccentTheme,
  type TerminalFontId,
  type UiFontId,
} from './appearance'
import { ConversationView } from './history/ConversationView'
import { TerminalPane } from './terminal/TerminalPane'

type SessionState = 'idle' | 'starting' | 'running' | 'stopped'
type SessionView = 'cli' | 'conversation'
type LucideIconName = keyof typeof dynamicIconImports
type AgentIconMode = 'monogram' | 'lucide' | 'custom'
type SectionKey = 'folders' | 'recent' | 'agents'
type SettingsSection = 'appearance' | 'notifications' | 'icons' | 'accounts'

interface AgentIconPreference {
  mode: AgentIconMode
  iconName?: LucideIconName
  dataUrl?: string
  backgroundColor?: string
}

interface AgentColorPickerState {
  agentId: string
  left: number
  top: number
}

interface LogicalFolder {
  id: string
  name: string
}

interface DraggedSidebarItem {
  kind: 'history' | 'session'
  key: string
}

interface FolderDropIndicator {
  folderId: string
  orderKey: string
  edge: 'before' | 'after'
}

interface RuntimeSession {
  id: string
  agentId: string
  cwd: string
  title: string
  account?: AgentAccount
  purpose: 'session' | 'login'
  resumeId: string
  folderId: string
  historyKey: string
  conversation: ConversationHistory | null
  conversationLoading: boolean
  conversationError: string
  state: SessionState
  statusDetail: string
  view: SessionView
  createdAt: number
  lastViewedAt: number
  lastActivityAt: number
}

interface SectionState {
  folders: boolean
  recent: boolean
  agents: boolean
}

const ACCOUNT_STORAGE_KEY = 'cli-agent-manager.account-overrides'
const SECTION_STORAGE_KEY = 'cli-agent-manager.sidebar-sections'
const THEME_STORAGE_KEY = 'cli-agent-manager.theme'
const SIDEBAR_WIDTH_STORAGE_KEY = 'cli-agent-manager.sidebar-width'
const FOLDERS_STORAGE_KEY = 'cli-agent-manager.folders'
const FOLDER_ASSIGNMENTS_STORAGE_KEY = 'cli-agent-manager.folder-assignments'
const FOLDER_ORDERS_STORAGE_KEY = 'cli-agent-manager.folder-orders'
const FOLDER_PANE_HEIGHT_STORAGE_KEY = 'cli-agent-manager.folder-pane-height'
const AGENT_ICONS_STORAGE_KEY = 'cli-agent-manager.agent-icons'
const LUCIDE_ICON_PAGE_SIZE = 120
const AGENT_COLOR_SWATCHES = [
  '#30363D', '#56616B', '#8B949E', '#D8DEE4',
  '#8E3B46', '#C54B5B', '#D86F45', '#B47724',
  '#C49A32', '#6F8A35', '#2F8F67', '#258B86',
  '#3276A8', '#4A68B3', '#6454B2', '#8656A7',
  '#A34F87', '#9B5A45', '#3E6F73', '#5E6673',
]
const MAX_RUNTIME_SESSIONS = 10
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000
const SESSION_SWEEP_INTERVAL_MS = 60 * 1000
const DEFAULT_SIDEBAR_WIDTH = 272
const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH = 420
const DEFAULT_FOLDER_PANE_HEIGHT = 240
const MIN_FOLDER_PANE_HEIGHT = 80
const MAX_FOLDER_PANE_HEIGHT = 520
const DEFAULT_SECTIONS: SectionState = { folders: true, recent: true, agents: true }
const DEFAULT_FOLDERS: LogicalFolder[] = [
  { id: 'prototype', name: 'Prototype' },
  { id: 'unsorted', name: 'Unsorted' },
]
const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  desktopEnabled: true,
  needsAttention: true,
  failed: true,
  completed: true,
}
const EMPTY_NOTIFICATION_SNAPSHOT: NotificationSnapshot = {
  version: 0,
  notifications: [],
  settings: DEFAULT_NOTIFICATION_SETTINGS,
  mutedSessionIds: [],
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

function savedAccounts(): AgentAccount[] {
  const accounts = loadJson<unknown>(ACCOUNT_STORAGE_KEY, [])
  return Array.isArray(accounts) ? accounts as AgentAccount[] : []
}

function accountIdentity(account: Pick<AgentAccount, 'agentId' | 'configDir'>): string {
  const configDir = account.configDir.trim().replace(/[\\/]+$/, '').toLocaleLowerCase()
  return `${account.agentId}:${configDir}`
}

function savedTheme(): AccentTheme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  return ACCENT_OPTIONS.some((option) => option.id === stored) ? stored as AccentTheme : 'amber'
}

function savedSidebarWidth(): number {
  const value = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY))
  return Number.isFinite(value) ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value)) : DEFAULT_SIDEBAR_WIDTH
}

function savedFolderPaneHeight(): number {
  const value = Number(localStorage.getItem(FOLDER_PANE_HEIGHT_STORAGE_KEY))
  return Number.isFinite(value)
    ? Math.min(MAX_FOLDER_PANE_HEIGHT, Math.max(MIN_FOLDER_PANE_HEIGHT, value))
    : DEFAULT_FOLDER_PANE_HEIGHT
}

function savedFolders(): LogicalFolder[] {
  const value = loadJson<unknown>(FOLDERS_STORAGE_KEY, DEFAULT_FOLDERS)
  if (!Array.isArray(value)) return DEFAULT_FOLDERS
  const valid = value.filter((item): item is LogicalFolder => (
    typeof item === 'object' && item !== null
    && typeof (item as LogicalFolder).id === 'string'
    && typeof (item as LogicalFolder).name === 'string'
  ))
  return valid.length ? valid : DEFAULT_FOLDERS
}

function savedFolderAssignments(): Record<string, string> {
  const value = loadJson<unknown>(FOLDER_ASSIGNMENTS_STORAGE_KEY, {})
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

function savedFolderOrders(): Record<string, string[]> {
  const value = loadJson<unknown>(FOLDER_ORDERS_STORAGE_KEY, {})
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([folderId, keys]) => (
    Array.isArray(keys) && keys.every((key) => typeof key === 'string') ? [[folderId, keys]] : []
  )))
}

function savedAgentIcons(): Record<string, AgentIconPreference> {
  const value = loadJson<unknown>(AGENT_ICONS_STORAGE_KEY, {})
  const legacySet = localStorage.getItem('cli-agent-manager.agent-icon-set')
  const legacyIconNames = {
    powershell: 'square-terminal',
    claude: 'bot',
    codex: 'braces',
    gemini: 'sparkles',
    opencode: 'box',
  } as Record<string, LucideIconName>
  if (legacySet === 'default') {
    return Object.fromEntries(Object.keys(legacyIconNames).map((agentId) => [agentId, { mode: 'monogram' }]))
  }
  if (legacySet === 'lucide') {
    return Object.fromEntries(Object.entries(legacyIconNames).map(([agentId, iconName]) => [agentId, { mode: 'lucide', iconName }]))
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const legacyModes: Record<string, LucideIconName> = {
    terminal: 'square-terminal',
    bot: 'bot',
    code: 'braces',
    sparkles: 'sparkles',
    box: 'box',
  }
  const result: Record<string, AgentIconPreference> = {}
  for (const [agentId, preference] of Object.entries(value)) {
    if (typeof preference !== 'object' || preference === null) continue
    const candidate = preference as { mode?: string; iconName?: string; dataUrl?: string; backgroundColor?: string }
    const backgroundColor = /^#[0-9a-f]{6}$/i.test(candidate.backgroundColor ?? '') ? candidate.backgroundColor : undefined
    if (candidate.mode === 'monogram') {
      result[agentId] = { mode: 'monogram', backgroundColor }
      continue
    }
    if (candidate.mode === 'custom' && candidate.dataUrl?.startsWith('data:image/')) {
      result[agentId] = { mode: 'custom', dataUrl: candidate.dataUrl, backgroundColor }
      continue
    }
    const iconName = candidate.mode === 'lucide' ? candidate.iconName : legacyModes[candidate.mode ?? '']
    if (iconName && iconName in dynamicIconImports) {
      result[agentId] = { mode: 'lucide', iconName: iconName as LucideIconName, backgroundColor }
    }
  }
  return result
}

function agentMonogram(agentId: string): string {
  return ({ powershell: 'PS', claude: 'C', codex: 'X', gemini: 'G', opencode: 'O' } as Record<string, string>)[agentId]
    ?? agentId.slice(0, 2).toUpperCase()
}

const LUCIDE_ICON_NAMES = Object.keys(dynamicIconImports) as LucideIconName[]
type DynamicIconComponent = ComponentType<{ size?: string | number }>
const dynamicIconComponents = new Map<LucideIconName, LazyExoticComponent<DynamicIconComponent>>()

function DynamicLucideIcon({ name, size }: { name: LucideIconName; size?: number }) {
  let Icon = dynamicIconComponents.get(name)
  if (!Icon) {
    const load = dynamicIconImports[name] as unknown as () => Promise<{ default: DynamicIconComponent }>
    Icon = lazy(load)
    dynamicIconComponents.set(name, Icon)
  }
  return <Suspense fallback={<span className="dynamic-icon-placeholder" />}><Icon size={size} /></Suspense>
}

function contrastColor(background: string): string {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(background.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  return luminance > 0.42 ? '#111418' : '#ffffff'
}

interface AgentAvatarProps {
  agentId: string
  className: string
  color?: string
  preference?: AgentIconPreference
}

function AgentAvatar({ agentId, className, color, preference }: AgentAvatarProps) {
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

function stateLabel(state: SessionState): string {
  if (state === 'running') return 'Running'
  if (state === 'starting') return 'Starting'
  if (state === 'stopped') return 'Stopped'
  return 'Idle'
}

function notificationTypeLabel(notification: AppNotification): string {
  if (notification.type === 'failed') return 'Failed'
  if (notification.type === 'completed') return 'Completed'
  if (notification.type === 'needs_attention') return 'Needs attention'
  if (notification.type === 'account_changed') return 'Account changed'
  return 'Activity'
}

function NotificationTypeIcon({ notification, size = 13 }: { notification: AppNotification; size?: number }) {
  if (notification.type === 'failed') return <TriangleAlert size={size} />
  if (notification.type === 'completed') return <Check size={size} />
  return <Bell size={size} />
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function SessionClock({ session }: { session: RuntimeSession }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <span>idle {formatElapsed(now - session.lastActivityAt)} · closes after 30 min in background</span>
}

interface SectionHeadingProps {
  label: string
  count: string | number
  open: boolean
  onToggle: () => void
  actions?: React.ReactNode
}

function SectionHeading({ label, count, open, onToggle, actions }: SectionHeadingProps) {
  return (
    <div className="sidebar-heading">
      <button className="section-toggle" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{label}</span>
      </button>
      <span className="section-count">{count}</span>
      {actions}
    </div>
  )
}

interface SettingsToggleProps {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}

function SettingsToggle({ label, checked, disabled = false, onChange }: SettingsToggleProps) {
  return (
    <div className={`settings-toggle-row ${disabled ? 'disabled' : ''}`}>
      <span>{label}</span>
      <button
        className={`settings-toggle ${checked ? 'active' : ''}`}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      ><span /></button>
    </div>
  )
}

interface AppearanceColorProps {
  label: string
  value: string
  onChange: (value: string) => void
}

function AppearanceColor({ label, value, onChange }: AppearanceColorProps) {
  return (
    <label className="appearance-color">
      <span>{label}</span>
      <span className="appearance-color-value">
        <span className="appearance-color-swatch" style={{ background: value }} />
        <code>{value}</code>
        <input type="color" aria-label={label} value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} />
      </span>
    </label>
  )
}

export function App() {
  const [profiles, setProfiles] = useState<AgentHealth[]>([])
  const [profilesRefreshing, setProfilesRefreshing] = useState(false)
  const [history, setHistory] = useState<HistorySession[]>([])
  const [historyQuery, setHistoryQuery] = useState('')
  const [accounts, setAccounts] = useState<AgentAccount[]>(savedAccounts)
  const [draftAccounts, setDraftAccounts] = useState<AgentAccount[]>(accounts)
  const [accountSaveNotice, setAccountSaveNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [loginAccountRefreshing, setLoginAccountRefreshing] = useState('')
  const [accountId, setAccountId] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('appearance')
  const [notificationSnapshot, setNotificationSnapshot] = useState<NotificationSnapshot>(EMPTY_NOTIFICATION_SNAPSHOT)
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false)
  const [folders, setFolders] = useState<LogicalFolder[]>(savedFolders)
  const [folderAssignments, setFolderAssignments] = useState<Record<string, string>>(savedFolderAssignments)
  const [folderOrders, setFolderOrders] = useState<Record<string, string[]>>(savedFolderOrders)
  const [selectedFolderId, setSelectedFolderId] = useState('prototype')
  const [newFolderName, setNewFolderName] = useState<string | null>(null)
  const [draggedSidebarItem, setDraggedSidebarItem] = useState<DraggedSidebarItem | null>(null)
  const [dragOverFolderId, setDragOverFolderId] = useState('')
  const [folderDropIndicator, setFolderDropIndicator] = useState<FolderDropIndicator | null>(null)
  const [removingFolderEntry, setRemovingFolderEntry] = useState('')
  const [agentId, setAgentId] = useState('powershell')
  const [title, setTitle] = useState('')
  const [cwd, setCwd] = useState('C:\\git_workspace')
  const [sessions, setSessions] = useState<RuntimeSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')
  const [sectionOpen, setSectionOpen] = useState<SectionState>(() => loadJson(SECTION_STORAGE_KEY, DEFAULT_SECTIONS))
  const [sidebarWidth, setSidebarWidth] = useState(savedSidebarWidth)
  const [folderPaneHeight, setFolderPaneHeight] = useState(savedFolderPaneHeight)
  const [theme, setTheme] = useState<AccentTheme>(savedTheme)
  const [appearance, setAppearance] = useState<AppearancePreferences>(loadAppearance)
  const [localFonts, setLocalFonts] = useState<string[]>([])
  const [localFontStatus, setLocalFontStatus] = useState('')
  const [agentIcons, setAgentIcons] = useState<Record<string, AgentIconPreference>>(savedAgentIcons)
  const [iconPickerAgentId, setIconPickerAgentId] = useState('')
  const [agentColorPicker, setAgentColorPicker] = useState<AgentColorPickerState | null>(null)
  const [agentColorDraft, setAgentColorDraft] = useState('')
  const [lucideIconQuery, setLucideIconQuery] = useState('')
  const [lucideIconPage, setLucideIconPage] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const accountsRef = useRef(accounts)
  const sessionsRef = useRef(sessions)
  const profileRefreshInFlight = useRef(false)
  const historyRefreshInFlight = useRef(false)
  const historyRefreshQueued = useRef(false)
  accountsRef.current = accounts
  sessionsRef.current = sessions

  const acceptNotificationSnapshot = (snapshot: NotificationSnapshot): void => {
    setNotificationSnapshot((current) => snapshot.version >= current.version ? snapshot : current)
  }

  const resolvedAgentIcon = (agent: string): AgentIconPreference => {
    return agentIcons[agent] ?? { mode: 'monogram' }
  }
  const filteredLucideIconNames = useMemo(() => {
    const query = lucideIconQuery.trim().toLocaleLowerCase()
    return query ? LUCIDE_ICON_NAMES.filter((name) => name.includes(query)) : LUCIDE_ICON_NAMES
  }, [lucideIconQuery])
  const lucideIconPageCount = Math.max(1, Math.ceil(filteredLucideIconNames.length / LUCIDE_ICON_PAGE_SIZE))
  const visibleLucideIconNames = filteredLucideIconNames.slice(
    lucideIconPage * LUCIDE_ICON_PAGE_SIZE,
    (lucideIconPage + 1) * LUCIDE_ICON_PAGE_SIZE,
  )
  const colorPickerProfile = agentColorPicker
    ? profiles.find((profile) => profile.id === agentColorPicker.agentId)
    : undefined
  const activeAgentColor = agentColorPicker
    ? agentIcons[agentColorPicker.agentId]?.backgroundColor ?? colorPickerProfile?.color ?? '#56616B'
    : '#56616B'

  const refreshProfiles = (): void => {
    if (profileRefreshInFlight.current) return
    profileRefreshInFlight.current = true
    setProfilesRefreshing(true)
    void window.cliAgent.getProfiles().then((items) => {
      setProfiles(items)
      setAgentId((current) => items.some((profile) => profile.id === current && profile.available)
        ? current
        : items.find((profile) => profile.available)?.id ?? items[0]?.id ?? '')
    }).finally(() => {
      profileRefreshInFlight.current = false
      setProfilesRefreshing(false)
    })
  }

  const refreshHistory = (accountList?: AgentAccount[]): void => {
    if (historyRefreshInFlight.current) {
      historyRefreshQueued.current = true
      return
    }
    historyRefreshInFlight.current = true
    void window.cliAgent.listHistory(accountList ?? accountsRef.current).then((items) => {
      setHistory((current) => {
        const unchanged = current.length === items.length && current.every((item, index) => (
          item.key === items[index]?.key
          && item.updatedAt === items[index]?.updatedAt
          && item.title === items[index]?.title
          && item.cwd === items[index]?.cwd
          && item.accountEmail === items[index]?.accountEmail
          && item.messageCount === items[index]?.messageCount
        ))
        return unchanged ? current : items
      })
    }).finally(() => {
      historyRefreshInFlight.current = false
      if (historyRefreshQueued.current) {
        historyRefreshQueued.current = false
        refreshHistory()
      }
    })
  }

  useEffect(() => {
    refreshProfiles()
    void window.cliAgent.detectAccounts().then((detected) => {
      const manual = savedAccounts()
      const merged = [...detected]
      for (const account of manual) {
        if (!merged.some((item) => accountIdentity(item) === accountIdentity(account))) {
          merged.push(account)
        }
      }
      setAccounts(merged)
      setDraftAccounts(merged)
      refreshHistory(merged)
    })
  }, [])

  useEffect(() => {
    let mounted = true
    void window.cliAgent.getNotificationSnapshot().then((snapshot) => {
      if (mounted) acceptNotificationSnapshot(snapshot)
    })
    const offChanged = window.cliAgent.onNotificationsChanged((snapshot) => {
      if (mounted) acceptNotificationSnapshot(snapshot)
    })
    const offActivated = window.cliAgent.onNotificationActivated((activation) => {
      if (activation.kind === 'panel') {
        setNotificationPanelOpen(true)
        return
      }
      if (!sessionsRef.current.some((session) => session.id === activation.sessionId)) {
        setNotificationPanelOpen(true)
        return
      }
      const now = Date.now()
      setSessions((current) => current.map((session) => (
        session.id === activation.sessionId
          ? { ...session, view: 'cli', lastViewedAt: now }
          : session
      )))
      setActiveSessionId(activation.sessionId)
      setNotificationPanelOpen(false)
      void window.cliAgent.acknowledgeSessionNotification(activation.sessionId).then(acceptNotificationSnapshot)
    })
    return () => {
      mounted = false
      offChanged()
      offActivated()
    }
  }, [])

  useEffect(() => {
    const reconcileProfiles = (): void => {
      if (document.visibilityState === 'visible') refreshProfiles()
    }
    const timer = window.setInterval(reconcileProfiles, 60_000)
    window.addEventListener('focus', reconcileProfiles)
    document.addEventListener('visibilitychange', reconcileProfiles)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', reconcileProfiles)
      document.removeEventListener('visibilitychange', reconcileProfiles)
    }
  }, [])

  useEffect(() => {
    if (!settingsOpen) setAgentColorPicker(null)
  }, [settingsOpen])

  useEffect(() => {
    if (!agentColorPicker) return undefined
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setAgentColorPicker(null)
    }
    const closeOnResize = (): void => setAgentColorPicker(null)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeOnResize)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeOnResize)
    }
  }, [agentColorPicker])

  useEffect(() => {
    localStorage.removeItem('cli-agent-manager.agent-icon-set')
    localStorage.setItem(AGENT_ICONS_STORAGE_KEY, JSON.stringify(agentIcons))
  }, [])

  useEffect(() => {
    const offHistoryChanged = window.cliAgent.onHistoryChanged(() => refreshHistory())
    const reconcile = (): void => {
      if (document.visibilityState === 'visible') refreshHistory()
    }
    const timer = window.setInterval(reconcile, 60_000)
    document.addEventListener('visibilitychange', reconcile)
    return () => {
      offHistoryChanged()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', reconcile)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(folders))
  }, [folders])

  useEffect(() => {
    localStorage.setItem(FOLDER_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(folderAssignments))
  }, [folderAssignments])

  useEffect(() => {
    localStorage.setItem(FOLDER_ORDERS_STORAGE_KEY, JSON.stringify(folderOrders))
  }, [folderOrders])

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === agentId),
    [profiles, agentId],
  )
  const agentAccounts = accounts.filter((account) => account.agentId === agentId)
  const selectedAccount = accounts.find((account) => account.id === accountId)
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const activeSessionMuted = notificationSnapshot.mutedSessionIds.includes(activeSessionId)
  const activeProfile = profiles.find((profile) => profile.id === activeSession?.agentId)
  const filteredHistory = history.filter((session) => {
    const query = historyQuery.trim().toLocaleLowerCase()
    if (!query) return true
    return `${session.title} ${session.cwd} ${session.agentId} ${session.accountEmail ?? ''}`.toLocaleLowerCase().includes(query)
  })
  const themeStyle = {
    '--acc': ACCENT_OPTIONS.find((option) => option.id === theme)?.color ?? ACCENT_OPTIONS[0].color,
    '--acc-ink': ACCENT_OPTIONS.find((option) => option.id === theme)?.ink ?? ACCENT_OPTIONS[0].ink,
    '--app-bg': appearance.appBackground,
    '--app-fg': appearance.appForeground,
    '--terminal-bg': appearance.terminalBackground,
    '--ui-font': uiFontFamily(appearance.uiFont, appearance.localUiFont),
  } as CSSProperties

  useEffect(() => {
    window.cliAgent.updateNotificationContext({
      activeSessionId,
      activeView: activeSession?.view ?? 'none',
    })
  }, [activeSessionId, activeSession?.view])

  const updateSession = (id: string, update: Partial<RuntimeSession>): void => {
    setSessions((current) => current.map((session) => session.id === id ? { ...session, ...update } : session))
  }

  const addRuntimeSession = (session: Omit<RuntimeSession, 'id' | 'createdAt' | 'lastViewedAt' | 'lastActivityAt'>): string => {
    const id = crypto.randomUUID()
    const now = Date.now()
    const nextSession: RuntimeSession = { ...session, id, createdAt: now, lastViewedAt: now, lastActivityAt: now }
    setSessions((current) => {
      if (current.length < MAX_RUNTIME_SESSIONS) return [...current, nextSession]
      const candidates = current.filter((item) => item.id !== activeSessionId)
      const victim = (candidates.length ? candidates : current)
        .reduce((oldest, item) => item.lastViewedAt < oldest.lastViewedAt ? item : oldest)
      return [...current.filter((item) => item.id !== victim.id), nextSession]
    })
    setActiveSessionId(id)
    return id
  }

  const activateSession = (id: string): void => {
    const now = Date.now()
    setSessions((current) => current.map((session) => (
      session.id === id || session.id === activeSessionId ? { ...session, lastViewedAt: now } : session
    )))
    setActiveSessionId(id)
    void window.cliAgent.acknowledgeSessionNotification(id).then(acceptNotificationSnapshot)
  }

  const closeSession = (id: string): void => {
    setSessions((current) => current.filter((session) => session.id !== id))
    setActiveSessionId((current) => current === id ? '' : current)
    void window.cliAgent.acknowledgeSessionNotification(id).then(acceptNotificationSnapshot)
    void window.cliAgent.setSessionNotificationMuted(id, false).then(acceptNotificationSnapshot)
  }

  const startSession = (): void => {
    if (!agentId || !cwd.trim()) return
    const sessionCwd = cwd.trim()
    const fallbackTitle = `${selectedProfile?.label ?? agentId} - ${sessionCwd.split(/[\\/]/).filter(Boolean).at(-1) ?? sessionCwd}`
    addRuntimeSession({
      agentId,
      cwd: sessionCwd,
      title: title.trim() || fallbackTitle,
      account: selectedAccount,
      purpose: 'session',
      resumeId: '',
      folderId: selectedFolderId || 'unsorted',
      historyKey: '',
      conversation: null,
      conversationLoading: false,
      conversationError: '',
      state: 'idle',
      statusDetail: '',
      view: 'cli',
    })
    setTitle('')
  }

  useEffect(() => {
    const matching = accounts.filter((account) => account.agentId === agentId)
    if (!matching.some((account) => account.id === accountId)) setAccountId(matching[0]?.id ?? '')
  }, [agentId, accounts])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - SESSION_IDLE_TIMEOUT_MS
      const notifiedSessionIds = new Set(notificationSnapshot.notifications.map((notification) => notification.sessionId))
      setSessions((current) => current.filter((session) => (
        session.id === activeSessionId || notifiedSessionIds.has(session.id) || session.lastViewedAt >= cutoff
      )))
    }, SESSION_SWEEP_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [activeSessionId, notificationSnapshot.notifications])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.code === 'KeyK') {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if (event.ctrlKey && event.key === 'Enter' && !activeSession) {
        event.preventDefault()
        startSession()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeSession, agentId, cwd, title, selectedAccount, selectedFolderId])

  const toggleSection = (section: SectionKey): void => {
    setSectionOpen((current) => {
      const next = { ...current, [section]: !current[section] }
      localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  const setAndSaveSidebarWidth = (next: number): void => {
    const width = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, next))
    setSidebarWidth(width)
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width))
  }

  const beginSidebarResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    let latestWidth = startWidth

    const onPointerMove = (moveEvent: PointerEvent): void => {
      latestWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, startWidth + moveEvent.clientX - startX))
      setSidebarWidth(latestWidth)
    }
    const finish = (): void => {
      document.body.classList.remove('sidebar-resizing')
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(latestWidth))
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }

    document.body.classList.add('sidebar-resizing')
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const resizeSidebarWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setAndSaveSidebarWidth(sidebarWidth - 12)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setAndSaveSidebarWidth(sidebarWidth + 12)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setAndSaveSidebarWidth(DEFAULT_SIDEBAR_WIDTH)
    }
  }

  const setAndSaveFolderPaneHeight = (next: number): void => {
    const availableMaximum = Math.max(MIN_FOLDER_PANE_HEIGHT, Math.min(MAX_FOLDER_PANE_HEIGHT, window.innerHeight - 260))
    const height = Math.min(availableMaximum, Math.max(MIN_FOLDER_PANE_HEIGHT, next))
    setFolderPaneHeight(height)
    localStorage.setItem(FOLDER_PANE_HEIGHT_STORAGE_KEY, String(height))
  }

  const beginFolderPaneResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = folderPaneHeight
    let latestHeight = startHeight

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const availableMaximum = Math.max(MIN_FOLDER_PANE_HEIGHT, Math.min(MAX_FOLDER_PANE_HEIGHT, window.innerHeight - 260))
      latestHeight = Math.min(availableMaximum, Math.max(MIN_FOLDER_PANE_HEIGHT, startHeight + moveEvent.clientY - startY))
      setFolderPaneHeight(latestHeight)
    }
    const finish = (): void => {
      document.body.classList.remove('folder-pane-resizing')
      localStorage.setItem(FOLDER_PANE_HEIGHT_STORAGE_KEY, String(latestHeight))
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }

    document.body.classList.add('folder-pane-resizing')
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const resizeFolderPaneWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setAndSaveFolderPaneHeight(folderPaneHeight - 16)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setAndSaveFolderPaneHeight(folderPaneHeight + 16)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setAndSaveFolderPaneHeight(DEFAULT_FOLDER_PANE_HEIGHT)
    }
  }

  const changeTheme = (next: AccentTheme): void => {
    setTheme(next)
    localStorage.setItem(THEME_STORAGE_KEY, next)
  }

  const changeAppearance = (update: Partial<AppearancePreferences>): void => {
    setAppearance((current) => {
      const next = { ...current, ...update }
      saveAppearance(next)
      return next
    })
  }

  const discoverLocalFonts = (): void => {
    if (!window.queryLocalFonts) {
      setLocalFontStatus('Local font discovery is unavailable. Enter the family name manually.')
      return
    }
    setLocalFontStatus('Loading installed fonts...')
    void window.queryLocalFonts().then((fonts) => {
      const families = [...new Set(fonts.map((font) => font.family.trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right))
      setLocalFonts(families)
      setLocalFontStatus(families.length ? `${families.length} font families available` : 'No installed fonts were returned')
    }).catch(() => {
      setLocalFontStatus('Font access was denied. Enter the family name manually.')
    })
  }

  const changeNotificationSettings = (update: Partial<NotificationSettings>): void => {
    void window.cliAgent.updateNotificationSettings(update).then((snapshot) => {
      acceptNotificationSnapshot(snapshot)
      if (!snapshot.settings.enabled) setNotificationPanelOpen(false)
    })
  }

  const openNotification = (notification: AppNotification): void => {
    if (!sessionsRef.current.some((session) => session.id === notification.sessionId)) {
      void window.cliAgent.dismissNotification(notification.id).then(acceptNotificationSnapshot)
      return
    }
    updateSession(notification.sessionId, { view: 'cli', lastViewedAt: Date.now() })
    activateSession(notification.sessionId)
    setNotificationPanelOpen(false)
  }

  const toggleSessionNotificationMute = (sessionId: string, muted: boolean): void => {
    void window.cliAgent.setSessionNotificationMuted(sessionId, muted).then(acceptNotificationSnapshot)
  }

  const changeAgentIcon = (agentId: string, preference: AgentIconPreference): void => {
    setAgentIcons((current) => {
      const nextPreference = { ...preference, backgroundColor: current[agentId]?.backgroundColor }
      const next = { ...current, [agentId]: nextPreference }
      localStorage.setItem(AGENT_ICONS_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  const changeAgentIconBackground = (agentId: string, backgroundColor?: string): void => {
    setAgentIcons((current) => {
      const preference = current[agentId] ?? { mode: 'monogram' as const }
      const nextPreference = { ...preference, backgroundColor }
      const next = { ...current, [agentId]: nextPreference }
      localStorage.setItem(AGENT_ICONS_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  const openAgentColorPicker = (event: ReactMouseEvent<HTMLButtonElement>, agentId: string, color: string): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    const popoverWidth = 246
    const popoverHeight = 350
    const left = Math.min(window.innerWidth - popoverWidth - 12, Math.max(12, rect.right - popoverWidth))
    const below = rect.bottom + 8
    const top = below + popoverHeight <= window.innerHeight - 12
      ? below
      : Math.max(12, rect.top - popoverHeight - 8)

    setAgentColorDraft(color.toUpperCase())
    setAgentColorPicker({ agentId, left, top })
  }

  const selectAgentColor = (color: string): void => {
    if (!agentColorPicker) return
    const normalized = color.toUpperCase()
    setAgentColorDraft(normalized)
    changeAgentIconBackground(agentColorPicker.agentId, normalized)
  }

  const importAgentIcon = (agentId: string, file?: File): void => {
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return
    void createImageBitmap(file).then((bitmap) => {
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      const context = canvas.getContext('2d')
      if (!context) return
      const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height)
      const width = bitmap.width * scale
      const height = bitmap.height * scale
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
      bitmap.close()
      changeAgentIcon(agentId, { mode: 'custom', dataUrl: canvas.toDataURL('image/png') })
    }).catch(() => undefined)
  }

  const addFolder = (): void => {
    const name = newFolderName?.trim()
    if (!name) {
      setNewFolderName(null)
      return
    }
    const id = crypto.randomUUID()
    setFolders((items) => [...items, { id, name }])
    setSelectedFolderId(id)
    setNewFolderName(null)
  }

  const setHistoryFolder = (historyKey: string, folderId: string): void => {
    setFolderAssignments((current) => ({ ...current, [historyKey]: folderId }))
    setSessions((current) => current.map((session) => (
      session.historyKey === historyKey ? { ...session, folderId } : session
    )))
  }

  const sidebarItemOrderKey = (item: DraggedSidebarItem): string => {
    if (item.kind === 'history') return `history:${item.key}`
    const session = sessions.find((candidate) => candidate.id === item.key)
    return session?.historyKey ? `history:${session.historyKey}` : `session:${item.key}`
  }

  const moveSidebarItem = (
    item: DraggedSidebarItem,
    folderId: string,
    targetOrderKey?: string,
    edge: 'before' | 'after' = 'after',
  ): void => {
    const orderKey = sidebarItemOrderKey(item)
    const session = item.kind === 'session' ? sessions.find((candidate) => candidate.id === item.key) : undefined
    const alreadyInTarget = item.kind === 'history'
      ? folderAssignments[item.key] === folderId
      : session?.folderId === folderId

    if (item.kind === 'history') {
      setHistoryFolder(item.key, folderId)
    } else if (session) {
      updateSession(session.id, { folderId })
      if (session.historyKey) setHistoryFolder(session.historyKey, folderId)
    }

    setFolderOrders((current) => {
      if (alreadyInTarget && !targetOrderKey && current[folderId]?.includes(orderKey)) return current
      const targetSessions = sessions.filter((candidate) => candidate.folderId === folderId)
      const targetSessionHistory = new Set(targetSessions.map((candidate) => candidate.historyKey).filter(Boolean))
      const currentTargetOrder = current[folderId] ?? []
      const currentPosition = new Map(currentTargetOrder.map((key, index) => [key, index]))
      const visibleTargetKeys = [
        ...targetSessions.map((candidate) => candidate.historyKey ? `history:${candidate.historyKey}` : `session:${candidate.id}`),
        ...history.filter((candidate) => (
          folderAssignments[candidate.key] === folderId && !targetSessionHistory.has(candidate.key)
        )).map((candidate) => `history:${candidate.key}`),
      ].sort((left, right) => (
        (currentPosition.get(left) ?? Number.MAX_SAFE_INTEGER)
        - (currentPosition.get(right) ?? Number.MAX_SAFE_INTEGER)
      ))
      const hydratedTargetOrder = [
        ...currentTargetOrder,
        ...visibleTargetKeys.filter((key) => !currentTargetOrder.includes(key)),
      ]
      const next = Object.fromEntries(Object.entries(current).map(([id, keys]) => (
        [id, keys.filter((key) => key !== orderKey)]
      ))) as Record<string, string[]>
      const targetKeys = hydratedTargetOrder.filter((key) => key !== orderKey)
      const targetIndex = targetOrderKey ? targetKeys.indexOf(targetOrderKey) : -1
      const insertionIndex = targetIndex < 0 ? targetKeys.length : targetIndex + (edge === 'after' ? 1 : 0)
      targetKeys.splice(insertionIndex, 0, orderKey)
      next[folderId] = targetKeys
      return next
    })
  }

  const removeFolderOrderKey = (orderKey: string): void => {
    setFolderOrders((current) => Object.fromEntries(Object.entries(current).map(([id, keys]) => (
      [id, keys.filter((key) => key !== orderKey)]
    ))))
  }

  const startSidebarDrag = (event: ReactDragEvent<HTMLElement>, item: DraggedSidebarItem): void => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-cli-agent-item', JSON.stringify(item))
    setDraggedSidebarItem(item)
  }

  const finishSidebarDrag = (): void => {
    setDraggedSidebarItem(null)
    setDragOverFolderId('')
    setFolderDropIndicator(null)
  }

  const dropIntoFolder = (event: ReactDragEvent<HTMLElement>, folderId: string): void => {
    event.preventDefault()
    const item = draggedSidebarItem
    if (!item) return

    moveSidebarItem(item, folderId)
    setSelectedFolderId(folderId)
    finishSidebarDrag()
  }

  const dragOverFolderEntry = (
    event: ReactDragEvent<HTMLElement>,
    folderId: string,
    orderKey: string,
  ): void => {
    if (!draggedSidebarItem || sidebarItemOrderKey(draggedSidebarItem) === orderKey) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const bounds = event.currentTarget.getBoundingClientRect()
    const edge = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
    setDragOverFolderId(folderId)
    setFolderDropIndicator({ folderId, orderKey, edge })
  }

  const dropByFolderEntry = (
    event: ReactDragEvent<HTMLElement>,
    folderId: string,
    targetOrderKey: string,
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    const item = draggedSidebarItem
    if (!item || sidebarItemOrderKey(item) === targetOrderKey) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const edge = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
    moveSidebarItem(item, folderId, targetOrderKey, edge)
    setSelectedFolderId(folderId)
    finishSidebarDrag()
  }

  const removeHistoryFromFolder = (historyKey: string): void => {
    const removalKey = `history:${historyKey}`
    setRemovingFolderEntry(removalKey)
    window.setTimeout(() => {
      setFolderAssignments((current) => {
        const next = { ...current }
        delete next[historyKey]
        return next
      })
      removeFolderOrderKey(removalKey)
      setRemovingFolderEntry((current) => current === removalKey ? '' : current)
    }, 180)
  }

  const closeFolderSession = (session: RuntimeSession): void => {
    const removalKey = `session:${session.id}`
    setRemovingFolderEntry(removalKey)
    window.setTimeout(() => {
      if (session.historyKey) {
        setFolderAssignments((current) => {
          if (!(session.historyKey in current)) return current
          const next = { ...current }
          delete next[session.historyKey]
          return next
        })
      }
      removeFolderOrderKey(session.historyKey ? `history:${session.historyKey}` : `session:${session.id}`)
      closeSession(session.id)
      setRemovingFolderEntry((current) => current === removalKey ? '' : current)
    }, 180)
  }

  const selectWorkingDirectory = (): void => {
    void window.cliAgent.selectDirectory(cwd).then((selected) => {
      if (selected) setCwd(selected)
    })
  }

  const resumeConversation = (historySession: HistorySession): void => {
    const targetFolderId = selectedFolderId || folderAssignments[historySession.key] || 'unsorted'
    moveSidebarItem({ kind: 'history', key: historySession.key }, targetFolderId)
    const existing = sessions.find((session) => session.historyKey === historySession.key)
    if (existing) {
      activateSession(existing.id)
      return
    }
    const account = accounts.find((item) => item.id === historySession.accountId)
    const sessionCwd = historySession.cwd || cwd.trim() || 'C:\\git_workspace'
    addRuntimeSession({
      agentId: historySession.agentId,
      cwd: sessionCwd,
      title: historySession.title,
      account,
      purpose: 'session',
      resumeId: historySession.resumeId,
      folderId: targetFolderId,
      historyKey: historySession.key,
      conversation: null,
      conversationLoading: false,
      conversationError: '',
      state: 'idle',
      statusDetail: '',
      view: 'cli',
    })
  }

  const showConversation = (id: string): void => {
    const session = sessions.find((item) => item.id === id)
    if (!session?.historyKey) return
    updateSession(id, { view: 'conversation' })
    if (session.conversation || session.conversationLoading) return
    updateSession(id, { conversationLoading: true, conversationError: '' })
    void window.cliAgent.getConversation(session.historyKey).then((conversation) => {
      updateSession(id, { conversation, conversationLoading: false })
    }).catch((error: unknown) => {
      updateSession(id, {
        conversationLoading: false,
        conversationError: error instanceof Error ? error.message : String(error),
      })
    })
  }

  const saveAccounts = (): void => {
    const cleaned = draftAccounts
      .map((account) => ({ ...account, email: account.email.trim(), configDir: account.configDir.trim() }))
      .filter((account) => account.email && account.configDir)
    const identities = new Set<string>()
    const duplicate = cleaned.find((account) => {
      const identity = accountIdentity(account)
      if (identities.has(identity)) return true
      identities.add(identity)
      return false
    })
    if (duplicate) {
      setAccountSaveNotice({ kind: 'error', text: 'Each agent and configuration directory can be used by only one account.' })
      return
    }
    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(cleaned))
    setAccounts(cleaned)
    setDraftAccounts(cleaned)
    setAccountSaveNotice({ kind: 'success', text: 'Saved.' })
    refreshHistory(cleaned)
  }

  const addAccount = (): void => {
    const firstAgent = profiles.find((profile) => profile.id !== 'powershell')?.id ?? 'claude'
    setAccountSaveNotice(null)
    setDraftAccounts((current) => [...current, {
      id: crypto.randomUUID(),
      agentId: firstAgent,
      email: '',
      configDir: '',
    }])
  }

  const authenticateAccount = (account: AgentAccount): void => {
    const normalized = { ...account, email: account.email.trim(), configDir: account.configDir.trim() }
    if (!normalized.email || !normalized.configDir) return
    const nextAccounts = draftAccounts.map((item) => item.id === normalized.id ? normalized : item)
    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(nextAccounts))
    setAccounts(nextAccounts)
    setDraftAccounts(nextAccounts)
    const sessionCwd = cwd.trim() || 'C:\\git_workspace'
    addRuntimeSession({
      agentId: normalized.agentId,
      cwd: sessionCwd,
      title: `Sign in - ${normalized.email}`,
      account: normalized,
      purpose: 'login',
      resumeId: '',
      folderId: selectedFolderId || 'unsorted',
      historyKey: '',
      conversation: null,
      conversationLoading: false,
      conversationError: '',
      state: 'idle',
      statusDetail: '',
      view: 'cli',
    })
    setSettingsOpen(false)
  }

  const refreshLoginAccount = (session: RuntimeSession): void => {
    if (!session.account || loginAccountRefreshing) return
    setLoginAccountRefreshing(session.id)
    void window.cliAgent.inspectAccount(session.account).then((inspected) => {
      if (!inspected) {
        updateSession(session.id, { statusDetail: 'Unable to verify the signed-in account yet.' })
        return
      }
      const identity = accountIdentity(inspected)
      const currentAccounts = accountsRef.current
      const existing = currentAccounts.find((account) => accountIdentity(account) === identity)
      const refreshed: AgentAccount = {
        ...inspected,
        id: existing?.id ?? inspected.id,
        detected: existing?.detected,
      }
      const nextAccounts = existing
        ? currentAccounts.map((account) => accountIdentity(account) === identity ? refreshed : account)
        : [...currentAccounts, refreshed]
      localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(nextAccounts))
      accountsRef.current = nextAccounts
      setAccounts(nextAccounts)
      setDraftAccounts(nextAccounts)
      updateSession(session.id, {
        account: refreshed,
        title: `Sign in - ${refreshed.email}`,
        statusDetail: `Verified account: ${refreshed.email}`,
      })
      refreshHistory(nextAccounts)
    }).finally(() => setLoginAccountRefreshing(''))
  }

  const detectedVersions = profiles.filter((profile) => profile.available && profile.id !== 'powershell')
    .slice(0, 2).map((profile) => `${profile.id} ${profile.version ?? 'detected'}`).join(' · ')

  return (
    <main className="app-shell" data-theme={theme} style={themeStyle}>
      <header className="titlebar" onDoubleClick={() => window.cliAgent.toggleMaximizeWindow()}>
        <div className="titlebar-brand">
          <img className="brand-logo" src={moaCliIcon} alt="" draggable={false} />
          <strong>MoaCLI</strong>
        </div>
        <div className="window-controls" onDoubleClick={(event) => event.stopPropagation()}>
          <button title="Minimize" onClick={() => window.cliAgent.minimizeWindow()}><Minus size={16} /></button>
          <button title="Maximize or restore" onClick={() => window.cliAgent.toggleMaximizeWindow()}><Square size={12} /></button>
          <button className="window-close" title="Close" onClick={() => window.cliAgent.closeWindow()}><X size={16} /></button>
        </div>
      </header>

      <div className="app-body" style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
        <aside className="sidebar scroll">
          <div className="search-box">
            <Search size={14} aria-hidden="true" />
            <input ref={searchRef} aria-label="Search sessions" placeholder="Search sessions" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} />
            <kbd>Ctrl K</kbd>
          </div>

          <SectionHeading
            label="Folders"
            count={folders.length}
            open={sectionOpen.folders}
            onToggle={() => toggleSection('folders')}
            actions={(
              <span className="heading-actions">
                <button className="mini-icon-button" title="New folder" onClick={() => setNewFolderName('')}><FolderPlus size={13} /></button>
                <button className="mini-icon-button" title="New session" onClick={() => setActiveSessionId('')}><Plus size={14} /></button>
              </span>
            )}
          />
          {sectionOpen.folders && (
            <nav className="folder-tree" aria-label="Folders" style={{ height: `${folderPaneHeight}px` }}>
              {folders.map((folder) => {
                const folderSessions = sessions.filter((session) => session.folderId === folder.id)
                const sessionHistoryKeys = new Set(folderSessions.map((session) => session.historyKey).filter(Boolean))
                const assignedHistory = history.filter((item) => (
                  folderAssignments[item.key] === folder.id && !sessionHistoryKeys.has(item.key)
                ))
                const folderOrder = new Map((folderOrders[folder.id] ?? []).map((key, index) => [key, index]))
                const folderEntries = [
                  ...folderSessions.map((session) => ({
                    kind: 'session' as const,
                    orderKey: session.historyKey ? `history:${session.historyKey}` : `session:${session.id}`,
                    session,
                  })),
                  ...assignedHistory.map((historySession) => ({
                    kind: 'history' as const,
                    orderKey: `history:${historySession.key}`,
                    historySession,
                  })),
                ].sort((left, right) => (
                  (folderOrder.get(left.orderKey) ?? Number.MAX_SAFE_INTEGER)
                  - (folderOrder.get(right.orderKey) ?? Number.MAX_SAFE_INTEGER)
                ))
                return (
                  <div
                    className={`folder-node ${dragOverFolderId === folder.id ? 'drop-target' : ''}`}
                    key={folder.id}
                    onDragEnter={() => {
                      if (draggedSidebarItem) setDragOverFolderId(folder.id)
                    }}
                    onDragLeave={(event) => {
                      const nextTarget = event.relatedTarget as Node | null
                      if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
                        setDragOverFolderId('')
                        setFolderDropIndicator(null)
                      }
                    }}
                    onDragOver={(event) => {
                      if (!draggedSidebarItem) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      if (dragOverFolderId !== folder.id) setDragOverFolderId(folder.id)
                      if (folderDropIndicator) setFolderDropIndicator(null)
                    }}
                    onDrop={(event) => dropIntoFolder(event, folder.id)}
                  >
                    <button className={`tree-row ${selectedFolderId === folder.id ? 'active' : ''}`} aria-expanded={selectedFolderId === folder.id} onClick={() => setSelectedFolderId((current) => current === folder.id ? '' : folder.id)}>
                      {selectedFolderId === folder.id ? <FolderOpen size={15} /> : <Folder size={15} />}
                      <span>{folder.name}</span>
                      {(folderSessions.length + assignedHistory.length) > 0 && <small className="folder-count">{folderSessions.length + assignedHistory.length}</small>}
                    </button>
                    <div className={`folder-contents ${selectedFolderId === folder.id ? 'open' : ''}`}>
                      <div className="folder-contents-inner">
                    {folderEntries.map((entry) => {
                      const dropClass = folderDropIndicator?.folderId === folder.id && folderDropIndicator.orderKey === entry.orderKey
                        ? `drop-${folderDropIndicator.edge}`
                        : ''
                      if (entry.kind === 'session') {
                        const { session } = entry
                        const profile = profiles.find((item) => item.id === session.agentId)
                        const sessionNotification = notificationSnapshot.notifications.find((notification) => notification.sessionId === session.id)
                        return (
                          <div
                            className={`session-row folder-entry ${activeSessionId === session.id ? 'active' : ''} ${draggedSidebarItem?.kind === 'session' && draggedSidebarItem.key === session.id ? 'dragging' : ''} ${removingFolderEntry === `session:${session.id}` ? 'removing' : ''} ${dropClass}`}
                            draggable
                            key={entry.orderKey}
                            onDragStart={(event) => startSidebarDrag(event, { kind: 'session', key: session.id })}
                            onDragEnd={finishSidebarDrag}
                            onDragOver={(event) => dragOverFolderEntry(event, folder.id, entry.orderKey)}
                            onDrop={(event) => dropByFolderEntry(event, folder.id, entry.orderKey)}
                          >
                            <button className="session-select" onClick={() => activateSession(session.id)}>
                              <AgentAvatar agentId={session.agentId} className="tinted" color={profile?.color ?? '#7e878d'} preference={resolvedAgentIcon(session.agentId)} />
                              <span className="session-copy">
                                <span className="session-title-line">
                                  <strong title={session.title}>{session.title}</strong>
                                  {sessionNotification && (
                                    <span className={`session-notification-marker ${sessionNotification.type}`} title={notificationTypeLabel(sessionNotification)}>
                                      <NotificationTypeIcon notification={sessionNotification} size={11} />
                                    </span>
                                  )}
                                  <span className={`state-dot ${session.state}`} />
                                </span>
                                <small>{session.cwd}</small>
                              </span>
                            </button>
                            <button className="session-close" title="Remove from folder and close session" draggable={false} onClick={() => closeFolderSession(session)}><X size={13} /></button>
                          </div>
                        )
                      }

                      const { historySession } = entry
                      const profile = profiles.find((item) => item.id === historySession.agentId)
                      return (
                        <div
                          className={`session-row folder-entry history-entry ${draggedSidebarItem?.kind === 'history' && draggedSidebarItem.key === historySession.key ? 'dragging' : ''} ${removingFolderEntry === `history:${historySession.key}` ? 'removing' : ''} ${dropClass}`}
                          draggable
                          key={entry.orderKey}
                          onDragStart={(event) => startSidebarDrag(event, { kind: 'history', key: historySession.key })}
                          onDragEnd={finishSidebarDrag}
                          onDragOver={(event) => dragOverFolderEntry(event, folder.id, entry.orderKey)}
                          onDrop={(event) => dropByFolderEntry(event, folder.id, entry.orderKey)}
                        >
                          <button className="session-select" onClick={() => resumeConversation(historySession)}>
                            <AgentAvatar agentId={historySession.agentId} className="tinted" color={profile?.color ?? '#7e878d'} preference={resolvedAgentIcon(historySession.agentId)} />
                            <span className="session-copy">
                              <strong title={historySession.title}>{historySession.title}</strong>
                              <small>{historySession.agentId} · {new Date(historySession.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</small>
                            </span>
                          </button>
                          <button className="session-close" title="Remove from folder" draggable={false} onClick={() => removeHistoryFromFolder(historySession.key)}><X size={13} /></button>
                        </div>
                      )
                    })}
                    {!folderSessions.length && !assignedHistory.length && <p className="folder-empty">No conversations</p>}
                      </div>
                    </div>
                  </div>
                )
              })}
              {newFolderName !== null && (
                <div className="new-folder-row">
                  <Folder size={15} />
                  <input autoFocus aria-label="Folder name" value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} onBlur={addFolder} onKeyDown={(event) => {
                    if (event.key === 'Enter') addFolder()
                    if (event.key === 'Escape') setNewFolderName(null)
                  }} />
                </div>
              )}
            </nav>
          )}

          {sectionOpen.folders && sectionOpen.recent && (
            <div
              className="folder-pane-resizer"
              role="separator"
              aria-label="Resize Folders and Recent"
              aria-orientation="horizontal"
              aria-valuemin={MIN_FOLDER_PANE_HEIGHT}
              aria-valuemax={MAX_FOLDER_PANE_HEIGHT}
              aria-valuenow={Math.round(folderPaneHeight)}
              tabIndex={0}
              onPointerDown={beginFolderPaneResize}
              onDoubleClick={() => setAndSaveFolderPaneHeight(DEFAULT_FOLDER_PANE_HEIGHT)}
              onKeyDown={resizeFolderPaneWithKeyboard}
            />
          )}

          <SectionHeading
            label="Recent"
            count={filteredHistory.length}
            open={sectionOpen.recent}
            onToggle={() => toggleSection('recent')}
            actions={<button className="mini-icon-button" title="Refresh conversations" onClick={() => refreshHistory()}><RefreshCw size={13} /></button>}
          />
          {sectionOpen.recent && (
            <nav className="history-list" aria-label="Recent conversations">
              {filteredHistory.map((historySession) => (
                <button
                  className={`history-session ${activeSession?.historyKey === historySession.key ? 'active' : ''} ${draggedSidebarItem?.kind === 'history' && draggedSidebarItem.key === historySession.key ? 'dragging' : ''}`}
                  draggable
                  key={historySession.key}
                  onClick={() => resumeConversation(historySession)}
                  onDragStart={(event) => startSidebarDrag(event, { kind: 'history', key: historySession.key })}
                  onDragEnd={finishSidebarDrag}
                >
                  <AgentAvatar agentId={historySession.agentId} className="neutral" preference={resolvedAgentIcon(historySession.agentId)} />
                  <span className="session-copy">
                    <strong title={historySession.title}>{historySession.title}</strong>
                    <small>
                      {historySession.agentId} · {new Date(historySession.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {folderAssignments[historySession.key] && <span className="history-folder-label"> · {folders.find((folder) => folder.id === folderAssignments[historySession.key])?.name}</span>}
                    </small>
                  </span>
                </button>
              ))}
              {!filteredHistory.length && <p className="no-history">No conversations found for connected accounts</p>}
            </nav>
          )}

          <div className="agent-section">
            <SectionHeading
              label="Agents"
              count={`${profiles.filter((profile) => profile.available).length}/${profiles.length}`}
              open={sectionOpen.agents}
              onToggle={() => toggleSection('agents')}
              actions={<button className="mini-icon-button" title="Refresh CLI versions" disabled={profilesRefreshing} onClick={refreshProfiles}><RefreshCw size={13} /></button>}
            />
            {sectionOpen.agents && profiles.map((profile) => (
              <div className="health-row" key={profile.id} title={profile.resolvedPath ?? 'Not found'}>
                <AgentAvatar agentId={profile.id} className="neutral" preference={resolvedAgentIcon(profile.id)} />
                <span>{profile.label}</span>
                <small className={!profile.available ? 'error' : ''}>{profile.available ? profile.version ?? 'detected' : 'not found'}</small>
              </div>
            ))}
          </div>
          <div
            className="sidebar-resizer"
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            aria-valuemin={MIN_SIDEBAR_WIDTH}
            aria-valuemax={MAX_SIDEBAR_WIDTH}
            aria-valuenow={Math.round(sidebarWidth)}
            tabIndex={0}
            onPointerDown={beginSidebarResize}
            onDoubleClick={() => setAndSaveSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
            onKeyDown={resizeSidebarWithKeyboard}
          />
        </aside>

        <section className="workspace">
          <div className="content-stage">
            {activeSession && (
              <header className="session-context">
                  <div className="session-summary">
                    <AgentAvatar agentId={activeSession.agentId} className="header" color={activeProfile?.color ?? '#7e878d'} preference={resolvedAgentIcon(activeSession.agentId)} />
                    <h1 title={activeSession.title}>{activeSession.title}</h1>
                    <span className={`state-chip ${activeSession.state}`} title={activeSession.statusDetail}><span />{stateLabel(activeSession.state)}</span>
                    {activeSession.account?.email && <span className="session-email">{activeSession.account.email}</span>}
                    <span className="session-cwd" title={activeSession.cwd}>{activeSession.cwd}</span>
                    {activeSession.purpose === 'login' && (
                      <button
                        className="icon-button context-account-refresh"
                        title={activeSession.statusDetail.startsWith('Verified account:') ? activeSession.statusDetail : 'Refresh signed-in account'}
                        disabled={loginAccountRefreshing === activeSession.id}
                        onClick={() => refreshLoginAccount(activeSession)}
                      >
                        {activeSession.statusDetail.startsWith('Verified account:')
                          ? <Check size={15} />
                          : <RefreshCw className={loginAccountRefreshing === activeSession.id ? 'spinning' : ''} size={15} />}
                      </button>
                    )}
                    {notificationSnapshot.settings.enabled && activeSession.purpose === 'session' && (
                      <button
                        className="icon-button context-notification-mute"
                        title={activeSessionMuted ? 'Unmute session notifications' : 'Mute session notifications'}
                        aria-pressed={activeSessionMuted}
                        onClick={() => toggleSessionNotificationMute(activeSession.id, !activeSessionMuted)}
                      >
                        {activeSessionMuted ? <BellOff size={14} /> : <Bell size={14} />}
                      </button>
                    )}
                    <button className="icon-button context-close" title="Close session" onClick={() => closeSession(activeSession.id)}><X size={15} /></button>
                  </div>
                  <div className="session-subnav">
                    <nav className="view-tabs" aria-label="Session views">
                      <button className={activeSession.view === 'cli' ? 'active' : ''} onClick={() => updateSession(activeSession.id, { view: 'cli' })}>CLI</button>
                      <button className={activeSession.view === 'conversation' ? 'active' : ''} disabled={!activeSession.historyKey} onClick={() => showConversation(activeSession.id)}>
                        Conversation {activeSession.conversation?.messages.length ?? ''}
                      </button>
                    </nav>
                  </div>
              </header>
            )}
            {!activeSession && (
              <div className="launcher scroll">
                <div className="launcher-inner">
                  <div className="launcher-heading">
                    <span className="launcher-icon"><img src={moaCliIcon} alt="" draggable={false} /></span>
                    <h1>Start a new session</h1>
                    <p>Choose an agent and working directory to begin.</p>
                  </div>
                  <div className="launcher-card">
                    <div className="agent-picker" role="radiogroup" aria-label="Select an agent">
                      {profiles.map((profile) => (
                        <button key={profile.id} role="radio" aria-checked={agentId === profile.id} className={agentId === profile.id ? 'active' : ''} disabled={!profile.available} onClick={() => setAgentId(profile.id)} title={profile.available ? profile.label : `${profile.label} not found`}>
                          <AgentAvatar agentId={profile.id} className="picker" preference={resolvedAgentIcon(profile.id)} />
                          <span>{profile.label.replace(' Code', '').replace(' CLI', '')}</span>
                        </button>
                      ))}
                    </div>
                    <label className="launcher-field title-field">
                      <span>Title</span>
                      <input autoFocus maxLength={40} value={title} placeholder="Session title" onChange={(event) => setTitle(event.target.value)} />
                      <small>{title.length}/40</small>
                    </label>
                    <button className="launcher-field path-field" onClick={selectWorkingDirectory}>
                      <Folder size={15} />
                      <span>{cwd}</span>
                      <strong>Change</strong>
                    </button>
                    <label className="launcher-field account-field">
                      <span className="account-color" style={{ '--agent': selectedProfile?.color ?? '#7e878d' } as CSSProperties} />
                      {agentId === 'powershell' ? (
                        <span>Local shell</span>
                      ) : (
                        <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                          {agentAccounts.map((account) => <option key={account.id} value={account.id}>{account.email}</option>)}
                          {!agentAccounts.length && <option value="">Account setup required</option>}
                        </select>
                      )}
                      <small>Save in {folders.find((folder) => folder.id === selectedFolderId)?.name ?? 'Unsorted'}</small>
                    </label>
                  </div>
                  <div className="start-row">
                    <button className="start-button" onClick={startSession} disabled={!selectedProfile?.available || !cwd.trim() || (agentId !== 'powershell' && !selectedAccount)}>
                      <Play size={14} fill="currentColor" /> Start
                    </button>
                    <kbd>Ctrl↵</kbd>
                  </div>
                </div>
              </div>
            )}
            <div className={`session-view-stage ${activeSession ? '' : 'dormant'}`}>
              {sessions.map((session) => (
                <div className={`runtime-session ${activeSessionId === session.id ? 'active' : ''}`} key={session.id}>
                  <div className={`terminal-view ${session.view === 'cli' ? 'active' : ''}`}>
                    <TerminalPane
                      active={activeSessionId === session.id && session.view === 'cli'}
                      sessionId={session.id}
                      agentId={session.agentId}
                      cwd={session.cwd}
                      title={session.title}
                      account={session.account}
                      purpose={session.purpose}
                      resumeId={session.resumeId}
                      fontFamily={terminalFontFamily(appearance.terminalFont, appearance.localTerminalFont)}
                      fontSize={appearance.terminalFontSize}
                      foreground={appearance.terminalForeground}
                      cursorColor={ACCENT_OPTIONS.find((option) => option.id === theme)?.color ?? ACCENT_OPTIONS[0].color}
                      onActivity={() => updateSession(session.id, { lastActivityAt: Date.now() })}
                      onStateChange={(state, detail) => updateSession(session.id, { state, statusDetail: detail ?? '' })}
                    />
                    {(session.state === 'idle' || session.state === 'starting') && (
                      <div className="session-starting" role="status" aria-label="Connecting to CLI session">
                        <span className="session-starting-bar" />
                        <span className="session-starting-label">Connecting to CLI session</span>
                      </div>
                    )}
                  </div>
                  <div className={`conversation-tab ${session.view === 'conversation' ? 'active' : ''}`}>
                    <ConversationView conversation={session.conversation} loading={session.conversationLoading} error={session.conversationError} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <footer className="status-bar">
            <span className={`status-pill ${activeSession?.state ?? 'idle'}`}><span className="status-dot" />{activeSession?.state ?? 'idle'}</span>
            <span>{activeSession ? activeProfile?.version ?? activeSession.agentId : 'No session'}</span>
            <span>{sessions.length}/{MAX_RUNTIME_SESSIONS} open</span>
            <span className="status-right">{activeSession ? <SessionClock session={activeSession} /> : detectedVersions}</span>
          </footer>
        </section>
      </div>

      <button
        className={`floating-notifications ${notificationSnapshot.notifications.length ? 'has-items' : ''}`}
        title={notificationSnapshot.settings.enabled ? 'Notifications' : 'Notifications are off'}
        aria-label="Notifications"
        aria-expanded={notificationPanelOpen}
        onClick={() => setNotificationPanelOpen((current) => !current)}
      >
        {notificationSnapshot.settings.enabled ? <Bell size={15} /> : <BellOff size={15} />}
        {notificationSnapshot.notifications.length > 0 && (
          <span className="notification-count">{notificationSnapshot.notifications.length}</span>
        )}
      </button>

      <button className="floating-settings" title="Settings" onClick={() => {
        setDraftAccounts(accounts)
        setAccountSaveNotice(null)
        setNotificationPanelOpen(false)
        setSettingsOpen(true)
      }}><Settings2 size={16} /></button>

      {notificationPanelOpen && (
        <>
          <button className="notification-dismiss-layer" aria-label="Close notifications" onClick={() => setNotificationPanelOpen(false)} />
          <section className="notification-panel" aria-label="Notifications" aria-live="polite">
            <header>
              <div>
                <h2>Notifications</h2>
                <span>{notificationSnapshot.notifications.length} active</span>
              </div>
              <div className="notification-panel-actions">
                <button
                  className="icon-button"
                  title="Clear all"
                  disabled={!notificationSnapshot.notifications.length}
                  onClick={() => void window.cliAgent.clearNotifications().then(acceptNotificationSnapshot)}
                ><CheckCheck size={15} /></button>
                <button className="icon-button" title="Close" onClick={() => setNotificationPanelOpen(false)}><X size={15} /></button>
              </div>
            </header>
            <div className="notification-list scroll">
              {notificationSnapshot.notifications.map((notification) => {
                const profile = profiles.find((item) => item.id === notification.agentId)
                return (
                  <div className={`notification-row ${notification.type}`} key={notification.id}>
                    <button className="notification-open" onClick={() => openNotification(notification)}>
                      <AgentAvatar agentId={notification.agentId} className="tinted" color={profile?.color ?? '#7e878d'} preference={resolvedAgentIcon(notification.agentId)} />
                      <span className="notification-copy">
                        <span className="notification-kind"><NotificationTypeIcon notification={notification} size={12} />{notificationTypeLabel(notification)}</span>
                        <strong title={notification.title}>{notification.title}</strong>
                        <small>
                          {profile?.label ?? notification.agentId}
                          {notification.accountLabel ? ` · ${notification.accountLabel}` : ''}
                          {` · ${new Date(notification.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
                        </small>
                      </span>
                    </button>
                    <button
                      className="notification-dismiss"
                      title="Dismiss"
                      onClick={() => void window.cliAgent.dismissNotification(notification.id).then(acceptNotificationSnapshot)}
                    ><X size={13} /></button>
                  </div>
                )
              })}
              {!notificationSnapshot.settings.enabled && <p className="notification-empty">Notifications are off</p>}
              {notificationSnapshot.settings.enabled && !notificationSnapshot.notifications.length && <p className="notification-empty">No active notifications</p>}
            </div>
          </section>
        </>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSettingsOpen(false)
        }}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="account-settings-title">
            <header>
              <div><h2 id="account-settings-title">Settings</h2><p>Manage notifications, agent accounts, icons, and the interface theme.</p></div>
              <button className="icon-button" title="Close" onClick={() => setSettingsOpen(false)}><X size={16} /></button>
            </header>
            <div className="settings-layout">
              <nav className="settings-nav" aria-label="Settings sections">
                <button className={settingsSection === 'appearance' ? 'active' : ''} onClick={() => setSettingsSection('appearance')}><Palette size={15} />Appearance</button>
                <button className={settingsSection === 'notifications' ? 'active' : ''} onClick={() => setSettingsSection('notifications')}><Bell size={15} />Notifications</button>
                <button className={settingsSection === 'icons' ? 'active' : ''} onClick={() => setSettingsSection('icons')}><Shapes size={15} />Agent icons</button>
                <button className={settingsSection === 'accounts' ? 'active' : ''} onClick={() => setSettingsSection('accounts')}><LogIn size={15} />Accounts</button>
              </nav>
              <div className="settings-content scroll">
              <section className="appearance-settings" aria-labelledby="appearance-settings-title" hidden={settingsSection !== 'appearance'}>
                <div className="appearance-heading">
                  <h3 id="appearance-settings-title">Appearance</h3>
                  <button className="appearance-reset" title="Reset appearance" onClick={() => {
                    changeTheme('amber')
                    changeAppearance(DEFAULT_APPEARANCE)
                  }}><RotateCcw size={13} />Reset</button>
                </div>
                <div className="appearance-row">
                  <span>Accent</span>
                  <div className="theme-segments">
                    {ACCENT_OPTIONS.map((option) => (
                      <button className={theme === option.id ? 'active' : ''} key={option.id} onClick={() => changeTheme(option.id)}>
                        <span className="theme-swatch" style={{ background: option.color }} />{option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="appearance-row appearance-presets-row">
                  <span>Theme</span>
                  <div className="appearance-presets">
                    {APPEARANCE_PRESETS.map((preset) => (
                      <button
                        className={theme === preset.accent && Object.entries(preset.colors).every(([key, value]) => appearance[key as keyof typeof preset.colors] === value) ? 'active' : ''}
                        key={preset.id}
                        onClick={() => {
                          changeTheme(preset.accent)
                          changeAppearance(preset.colors)
                        }}
                      >
                        <span className="appearance-preset-swatch" style={{ background: `linear-gradient(135deg, ${preset.colors.appBackground} 50%, ${preset.colors.terminalBackground} 50%)` }} />
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="appearance-grid">
                  <label className="appearance-field">
                    <span>Interface font</span>
                    <select value={appearance.uiFont} onChange={(event) => changeAppearance({ uiFont: event.target.value as UiFontId })}>
                      {UI_FONT_OPTIONS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="appearance-field">
                    <span>Terminal font</span>
                    <select value={appearance.terminalFont} onChange={(event) => changeAppearance({ terminalFont: event.target.value as TerminalFontId })}>
                      {TERMINAL_FONT_OPTIONS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  {appearance.uiFont === 'local' && (
                    <label className="appearance-field local-font-field">
                      <span>Interface font family</span>
                      <input list="installed-font-families" value={appearance.localUiFont} placeholder="Enter an installed font" onChange={(event) => changeAppearance({ localUiFont: event.target.value })} />
                    </label>
                  )}
                  {appearance.terminalFont === 'local' && (
                    <label className="appearance-field local-font-field">
                      <span>Terminal font family</span>
                      <input list="installed-font-families" value={appearance.localTerminalFont} placeholder="Enter an installed font" onChange={(event) => changeAppearance({ localTerminalFont: event.target.value })} />
                    </label>
                  )}
                  <datalist id="installed-font-families">
                    {localFonts.map((family) => <option value={family} key={family} />)}
                  </datalist>
                </div>
                <div className="local-font-actions">
                  <button onClick={discoverLocalFonts}><RefreshCw size={13} />Load installed fonts</button>
                  {localFontStatus && <span>{localFontStatus}</span>}
                </div>
                <label className="terminal-font-size">
                  <span>Terminal size</span>
                  <input type="range" min="10" max="18" step="1" value={appearance.terminalFontSize} onChange={(event) => changeAppearance({ terminalFontSize: Number(event.target.value) })} />
                  <output>{appearance.terminalFontSize}px</output>
                </label>
                <div className="appearance-colors">
                  <AppearanceColor label="App background" value={appearance.appBackground} onChange={(appBackground) => changeAppearance({ appBackground })} />
                  <AppearanceColor label="App foreground" value={appearance.appForeground} onChange={(appForeground) => changeAppearance({ appForeground })} />
                  <AppearanceColor label="Terminal background" value={appearance.terminalBackground} onChange={(terminalBackground) => changeAppearance({ terminalBackground })} />
                  <AppearanceColor label="Terminal foreground" value={appearance.terminalForeground} onChange={(terminalForeground) => changeAppearance({ terminalForeground })} />
                </div>
              </section>
              <section className="notification-settings" aria-labelledby="notification-settings-title" hidden={settingsSection !== 'notifications'}>
                <div className="notification-settings-heading">
                  <h3 id="notification-settings-title">Notifications</h3>
                  <SettingsToggle
                    label="Enabled"
                    checked={notificationSnapshot.settings.enabled}
                    onChange={(enabled) => changeNotificationSettings({ enabled })}
                  />
                </div>
                <div className="notification-settings-options">
                  <SettingsToggle
                    label="Desktop notifications"
                    checked={notificationSnapshot.settings.desktopEnabled}
                    disabled={!notificationSnapshot.settings.enabled}
                    onChange={(desktopEnabled) => changeNotificationSettings({ desktopEnabled })}
                  />
                  <SettingsToggle
                    label="Needs attention"
                    checked={notificationSnapshot.settings.needsAttention}
                    disabled={!notificationSnapshot.settings.enabled}
                    onChange={(needsAttention) => changeNotificationSettings({ needsAttention })}
                  />
                  <SettingsToggle
                    label="Failed"
                    checked={notificationSnapshot.settings.failed}
                    disabled={!notificationSnapshot.settings.enabled}
                    onChange={(failed) => changeNotificationSettings({ failed })}
                  />
                  <SettingsToggle
                    label="Completed"
                    checked={notificationSnapshot.settings.completed}
                    disabled={!notificationSnapshot.settings.enabled}
                    onChange={(completed) => changeNotificationSettings({ completed })}
                  />
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
              <section className="agent-icon-settings" aria-labelledby="agent-icon-settings-title" hidden={settingsSection !== 'icons'}>
                <h3 id="agent-icon-settings-title">Agent icons</h3>
                {profiles.map((profile) => {
                  const mode = agentIcons[profile.id]?.mode ?? 'monogram'
                  return (
                    <div className="agent-icon-row" key={profile.id}>
                      <div className="agent-icon-identity">
                        <AgentAvatar agentId={profile.id} className="tinted" color={profile.color} preference={resolvedAgentIcon(profile.id)} />
                        <span>{profile.label}</span>
                      </div>
                      <div className="agent-icon-controls">
                        <div className="agent-icon-choices" role="radiogroup" aria-label={`${profile.label} icon`}>
                          <button className={mode === 'monogram' ? 'active' : ''} role="radio" aria-checked={mode === 'monogram'} title="Default monogram" onClick={() => changeAgentIcon(profile.id, { mode: 'monogram' })}>
                            <span>{agentMonogram(profile.id)}</span>
                          </button>
                          <button className={mode === 'lucide' ? 'active' : ''} role="radio" aria-checked={mode === 'lucide'} title="Choose a Lucide icon" onClick={() => {
                            setIconPickerAgentId(profile.id)
                            setLucideIconQuery('')
                            setLucideIconPage(0)
                          }}>
                          {mode === 'lucide' && agentIcons[profile.id]?.iconName
                            ? <DynamicLucideIcon name={agentIcons[profile.id].iconName as LucideIconName} size={14} />
                            : <Shapes size={14} />}
                          </button>
                          <label className={`agent-icon-upload ${mode === 'custom' ? 'active' : ''}`} role="radio" aria-checked={mode === 'custom'} title="Choose a custom image">
                            <ImagePlus size={14} />
                            <input type="file" aria-label={`Choose a custom image for ${profile.label}`} accept="image/png,image/jpeg,image/webp" onChange={(event) => {
                              importAgentIcon(profile.id, event.target.files?.[0])
                              event.target.value = ''
                            }} />
                          </label>
                        </div>
                        <button
                          className="agent-background-picker"
                          title="Icon background color"
                          aria-label={`Choose an icon background color for ${profile.label}`}
                          aria-haspopup="dialog"
                          onClick={(event) => openAgentColorPicker(event, profile.id, agentIcons[profile.id]?.backgroundColor ?? profile.color)}
                        >
                          <span style={{ background: agentIcons[profile.id]?.backgroundColor ?? profile.color }} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </section>
              <div className="account-fields" hidden={settingsSection !== 'accounts'}>
              {draftAccounts.map((account, index) => {
                const profile = profiles.find((item) => item.id === account.agentId)
                return (
                  <div className="account-row" key={account.id}>
                    <AgentAvatar agentId={account.agentId} className="tinted" color={profile?.color ?? '#7e878d'} preference={resolvedAgentIcon(account.agentId)} />
                    <div className="account-inputs">
                      <select value={account.agentId} disabled={account.detected} onChange={(event) => {
                        setAccountSaveNotice(null)
                        setDraftAccounts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, agentId: event.target.value } : item))
                      }}>
                        {profiles.filter((item) => item.id !== 'powershell').map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
                      </select>
                      <input type="email" value={account.email} readOnly={account.detected} placeholder="Account email" onChange={(event) => {
                        setAccountSaveNotice(null)
                        setDraftAccounts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, email: event.target.value } : item))
                      }} />
                      <input value={account.configDir} readOnly={account.detected} placeholder="Isolated config directory" onChange={(event) => {
                        setAccountSaveNotice(null)
                        setDraftAccounts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, configDir: event.target.value } : item))
                      }} />
                    </div>
                    <span className={`account-status ${account.detected ? 'verified' : ''}`}>{account.detected ? 'Verified' : 'Fixed'}</span>
                    <button className="icon-button" title="Sign in with the official CLI" disabled={!['claude', 'codex'].includes(account.agentId) || !account.email.trim() || !account.configDir.trim()} onClick={() => authenticateAccount(account)}><LogIn size={15} /></button>
                    <button className="icon-button" title={account.detected ? 'Auto-detected accounts are managed by the official CLI' : 'Delete account'} disabled={account.detected} onClick={() => {
                      setAccountSaveNotice(null)
                      setDraftAccounts((current) => current.filter((_, itemIndex) => itemIndex !== index))
                    }}><Trash2 size={15} /></button>
                  </div>
                )
              })}
              <button className="add-account-button" onClick={addAccount}><Plus size={14} />Add account</button>
              </div>
            </div>
            </div>
            <footer>
              {settingsSection === 'accounts' && accountSaveNotice && <span className={`account-save-notice ${accountSaveNotice.kind}`}>{accountSaveNotice.text}</span>}
              <button className="secondary-button" onClick={() => setSettingsOpen(false)}>Close</button>
              {settingsSection === 'accounts' && <button className="modal-save" onClick={saveAccounts}>Save</button>}
            </footer>
          </section>
        </div>
      )}

      {iconPickerAgentId && (
        <div className="icon-picker-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setIconPickerAgentId('')
        }}>
          <section className="icon-picker-modal" role="dialog" aria-modal="true" aria-labelledby="lucide-picker-title">
            <header>
              <div>
                <h2 id="lucide-picker-title">Lucide icons</h2>
                <p>{profiles.find((profile) => profile.id === iconPickerAgentId)?.label ?? iconPickerAgentId}</p>
              </div>
              <button className="icon-button" title="Close" onClick={() => setIconPickerAgentId('')}><X size={16} /></button>
            </header>
            <label className="icon-picker-search">
              <Search size={14} aria-hidden="true" />
              <input autoFocus value={lucideIconQuery} placeholder="Search icon names" onChange={(event) => {
                setLucideIconQuery(event.target.value)
                setLucideIconPage(0)
              }} />
            </label>
            <div className="lucide-icon-grid scroll">
              {visibleLucideIconNames.map((name) => (
                <button
                  className={agentIcons[iconPickerAgentId]?.mode === 'lucide' && agentIcons[iconPickerAgentId]?.iconName === name ? 'active' : ''}
                  title={name}
                  key={name}
                  onClick={() => {
                    changeAgentIcon(iconPickerAgentId, { mode: 'lucide', iconName: name })
                    setIconPickerAgentId('')
                  }}
                >
                  <DynamicLucideIcon name={name} size={18} />
                </button>
              ))}
              {!visibleLucideIconNames.length && <p className="icon-picker-empty">No matching icons</p>}
            </div>
            <footer>
              <span>{filteredLucideIconNames.length.toLocaleString()} icons</span>
              <div className="icon-picker-pagination">
                <button title="Previous page" disabled={lucideIconPage === 0} onClick={() => setLucideIconPage((current) => Math.max(0, current - 1))}><ChevronLeft size={15} /></button>
                <span>{Math.min(lucideIconPage + 1, lucideIconPageCount)} / {lucideIconPageCount}</span>
                <button title="Next page" disabled={lucideIconPage >= lucideIconPageCount - 1} onClick={() => setLucideIconPage((current) => Math.min(lucideIconPageCount - 1, current + 1))}><ChevronRight size={15} /></button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {agentColorPicker && (
        <div className="agent-color-popover-layer" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setAgentColorPicker(null)
        }}>
          <section
            className="agent-color-popover"
            role="dialog"
            aria-label={`${colorPickerProfile?.label ?? agentColorPicker.agentId} icon background color`}
            style={{ left: agentColorPicker.left, top: agentColorPicker.top }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h3>Background color</h3>
                <p>{colorPickerProfile?.label ?? agentColorPicker.agentId}</p>
              </div>
              <button
                className="agent-color-reset"
                title="Restore the default background color"
                disabled={!agentIcons[agentColorPicker.agentId]?.backgroundColor}
                onClick={() => {
                  changeAgentIconBackground(agentColorPicker.agentId)
                  setAgentColorDraft((colorPickerProfile?.color ?? '#56616B').toUpperCase())
                }}
              >
                <RotateCcw size={14} />
              </button>
            </header>
            <div className="agent-color-current">
              <span className="agent-color-preview" style={{ background: activeAgentColor }} />
              <label className="agent-color-hex">
                <span>#</span>
                <input
                  value={agentColorDraft.replace(/^#/, '')}
                  maxLength={6}
                  spellCheck={false}
                  aria-label="HEX color"
                  onChange={(event) => {
                    const raw = event.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6).toUpperCase()
                    setAgentColorDraft(`#${raw}`)
                    if (raw.length === 6) changeAgentIconBackground(agentColorPicker.agentId, `#${raw}`)
                  }}
                />
              </label>
            </div>
            <div className="agent-color-swatches" aria-label="Recommended colors">
              {AGENT_COLOR_SWATCHES.map((color) => {
                const selected = activeAgentColor.toLocaleLowerCase() === color.toLocaleLowerCase()
                return (
                  <button
                    className={selected ? 'active' : ''}
                    key={color}
                    title={color}
                    aria-label={color}
                    aria-pressed={selected}
                    style={{ '--swatch': color } as CSSProperties}
                    onClick={() => selectAgentColor(color)}
                  >
                    {selected && <Check size={13} />}
                  </button>
                )
              })}
            </div>
            <footer>
              <label className="agent-color-more">
                <Palette size={14} />
                <span>More colors</span>
                <input type="color" aria-label="Open the full color picker" value={activeAgentColor} onChange={(event) => selectAgentColor(event.target.value)} />
              </label>
              <button className="agent-color-done" onClick={() => setAgentColorPicker(null)}>Done</button>
            </footer>
          </section>
        </div>
      )}
    </main>
  )
}

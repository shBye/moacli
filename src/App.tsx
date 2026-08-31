import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { X } from 'lucide-react'
import type {
  AgentAccount,
  AgentHealth,
  AppNotification,
  ConversationHistory,
  ConversationSearchResult,
  DelegationSnapshot,
  HistorySession,
  NotificationSettings,
  NotificationSnapshot,
  SearchIndexState,
} from '../electron/contracts'
import {
  ACCENT_OPTIONS,
  DEFAULT_APPEARANCE,
  loadAppearance,
  saveAppearance,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  terminalFontFamily,
  uiFontFamily,
  type AppearancePreferences,
  type AccentTheme,
} from './appearance'
import type { LucideIconName } from './icons/LucideIconBrowser'
import { AgentAvatar } from './components/AgentAvatar'
import { AppTitlebar } from './components/AppTitlebar'
import { AgentColorPickerPopover } from './features/agent-icons/AgentColorPickerPopover'
import { calculateColorPickerPosition, type AgentColorPickerState } from './features/agent-icons/agent-color'
import type { AgentIconPreference } from './features/agent-icons/types'
import { buildFolderViews } from './features/folders/folder-view'
import type { LogicalFolder } from './features/folders/types'
import { useLocalFonts } from './features/fonts/useLocalFonts'
import { SessionLauncher } from './features/launcher/SessionLauncher'
import { DelegationApprovalModal } from './features/delegation/DelegationApprovalModal'
import { NotificationCenter } from './features/notifications/NotificationCenter'
import { ConversationSearchModal } from './features/search/ConversationSearchModal'
import { AppSidebar } from './features/sidebar/AppSidebar'
import type {
  DraggedSidebarItem,
  FolderDropIndicator,
  SidebarSectionKey,
  SidebarSectionState,
} from './features/sidebar/types'
import { useSidebarLayout } from './features/sidebar/useSidebarLayout'
import { SessionHeader } from './features/sessions/SessionHeader'
import { SessionRuntimeStage } from './features/sessions/SessionRuntimeStage'
import { StatusBar } from './features/sessions/StatusBar'
import type { RuntimeSession, SessionState, SessionView } from './features/sessions/types'
import { SettingsModal } from './features/settings/SettingsModal'
import type { AccountSaveNotice, SettingsSection } from './features/settings/types'
import { useAppUpdates } from './features/updates/useAppUpdates'

const ACCOUNT_STORAGE_KEY = 'cli-agent-manager.account-overrides'
const SECTION_STORAGE_KEY = 'cli-agent-manager.sidebar-sections'
const THEME_STORAGE_KEY = 'cli-agent-manager.theme'
const FOLDERS_STORAGE_KEY = 'cli-agent-manager.folders'
const FOLDER_ASSIGNMENTS_STORAGE_KEY = 'cli-agent-manager.folder-assignments'
const FOLDER_ORDERS_STORAGE_KEY = 'cli-agent-manager.folder-orders'
const MAX_RUNTIME_SESSIONS_STORAGE_KEY = 'cli-agent-manager.max-runtime-sessions'
const AGENT_ICONS_STORAGE_KEY = 'cli-agent-manager.agent-icons'
const DEFAULT_MAX_RUNTIME_SESSIONS = 10
const MIN_RUNTIME_SESSIONS = 1
const MAX_RUNTIME_SESSIONS_LIMIT = 30
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000
const SESSION_SWEEP_INTERVAL_MS = 60 * 1000
const DEFAULT_SECTIONS: SidebarSectionState = { folders: true, recent: true, agents: true }
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
const EMPTY_SEARCH_INDEX_STATE: SearchIndexState = {
  phase: 'idle',
  discoveredSources: 0,
  processedSources: 0,
  failedSources: 0,
  indexedSources: 0,
  indexedMessages: 0,
  lastUpdatedAt: 0,
  error: '',
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

function normalizedWorkingDirectory(value: string): string {
  return value.trim().replace(/[\\/]+$/, '').replace(/\\/g, '/').toLocaleLowerCase()
}

function savedTheme(): AccentTheme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  return ACCENT_OPTIONS.some((option) => option.id === stored) ? stored as AccentTheme : 'amber'
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
    if (iconName && /^[a-z0-9-]+$/.test(iconName)) {
      result[agentId] = { mode: 'lucide', iconName: iconName as LucideIconName, backgroundColor }
    }
  }
  return result
}

const LazyLucideIconPicker = lazy(() => import('./icons/LucideIconBrowser').then((module) => ({ default: module.LucideIconPicker })))
const LazySessionTabs = lazy(() => import('./features/session-tabs/SessionTabs').then((module) => ({ default: module.SessionTabs })))

function savedMaxRuntimeSessions(): number {
  const raw = localStorage.getItem(MAX_RUNTIME_SESSIONS_STORAGE_KEY)
  if (raw === null) return DEFAULT_MAX_RUNTIME_SESSIONS
  const stored = Number(raw)
  if (!Number.isFinite(stored)) return DEFAULT_MAX_RUNTIME_SESSIONS
  return Math.min(MAX_RUNTIME_SESSIONS_LIMIT, Math.max(MIN_RUNTIME_SESSIONS, Math.round(stored)))
}

export function App() {
  const [profiles, setProfiles] = useState<AgentHealth[]>([])
  const [profilesRefreshing, setProfilesRefreshing] = useState(false)
  const [history, setHistory] = useState<HistorySession[]>([])
  const [historyQuery, setHistoryQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchResults, setSearchResults] = useState<ConversationSearchResult[]>([])
  const [searchIndexState, setSearchIndexState] = useState<SearchIndexState>(EMPTY_SEARCH_INDEX_STATE)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchRebuilding, setSearchRebuilding] = useState(false)
  const [accounts, setAccounts] = useState<AgentAccount[]>(savedAccounts)
  const [draftAccounts, setDraftAccounts] = useState<AgentAccount[]>(accounts)
  const [accountSaveNotice, setAccountSaveNotice] = useState<AccountSaveNotice | null>(null)
  const [loginAccountRefreshing, setLoginAccountRefreshing] = useState('')
  const [accountId, setAccountId] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('appearance')
  const [delegationSnapshot, setDelegationSnapshot] = useState<DelegationSnapshot | null>(null)
  const [dismissedApprovalIds, setDismissedApprovalIds] = useState<ReadonlySet<string>>(() => new Set())
  const [focusedApprovalId, setFocusedApprovalId] = useState('')
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [approvalError, setApprovalError] = useState('')
  const openDelegationTaskRef = useRef<(taskId: string) => void>(() => undefined)
  const {
    appVersion,
    update: appUpdate,
    checking: updateChecking,
    opening: updateOpening,
    error: updateError,
    checkUpdate: checkAppUpdate,
    openDownload: openAppUpdateDownload,
  } = useAppUpdates(window.cliAgent)
  const [notificationSnapshot, setNotificationSnapshot] = useState<NotificationSnapshot>(EMPTY_NOTIFICATION_SNAPSHOT)
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false)
  const [folders, setFolders] = useState<LogicalFolder[]>(savedFolders)
  const [folderAssignments, setFolderAssignments] = useState<Record<string, string>>(savedFolderAssignments)
  const [folderOrders, setFolderOrders] = useState<Record<string, string[]>>(savedFolderOrders)
  const [selectedFolderId, setSelectedFolderId] = useState('prototype')
  const [newSessionFolderId, setNewSessionFolderId] = useState('unsorted')
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
  const [launcherOpen, setLauncherOpen] = useState(false)
  const [sectionOpen, setSectionOpen] = useState<SidebarSectionState>(() => loadJson(SECTION_STORAGE_KEY, DEFAULT_SECTIONS))
  const {
    sidebarWidth,
    sidebarCollapsed,
    folderPaneHeight,
    sidebarWidthRange,
    folderPaneHeightRange,
    appBodyRef,
    folderTreeRef,
    toggleSidebar,
    beginSidebarResize,
    resizeSidebarWithKeyboard,
    resetSidebarWidth,
    beginFolderPaneResize,
    resizeFolderPaneWithKeyboard,
    resetFolderPaneHeight,
  } = useSidebarLayout(localStorage)
  const [maxRuntimeSessions, setMaxRuntimeSessions] = useState(savedMaxRuntimeSessions)
  const [theme, setTheme] = useState<AccentTheme>(savedTheme)
  const [appearance, setAppearance] = useState<AppearancePreferences>(loadAppearance)
  const { families: localFonts, status: localFontStatus, discover: discoverLocalFonts } = useLocalFonts(window.queryLocalFonts)
  const [agentIcons, setAgentIcons] = useState<Record<string, AgentIconPreference>>(savedAgentIcons)
  const [iconPickerAgentId, setIconPickerAgentId] = useState('')
  const [agentColorPicker, setAgentColorPicker] = useState<AgentColorPickerState | null>(null)
  const [agentColorDraft, setAgentColorDraft] = useState('')
  const [windowMaximized, setWindowMaximized] = useState(false)
  const [zoomNotice, setZoomNotice] = useState<number | null>(null)
  const zoomNoticeTimer = useRef<number>()
  const activateSessionRef = useRef<(id: string, revealFolder?: boolean) => void>(() => undefined)
  const searchRef = useRef<HTMLInputElement>(null)
  const accountsRef = useRef(accounts)
  const sessionsRef = useRef(sessions)
  const activeSessionIdRef = useRef(activeSessionId)
  const sessionActivityTimesRef = useRef(new Map<string, number>())
  const folderSessionRefs = useRef(new Map<string, HTMLDivElement>())
  const profileRefreshInFlight = useRef(false)
  const historyRefreshInFlight = useRef(false)
  const historyRefreshQueued = useRef(false)
  const searchRequestId = useRef(0)
  accountsRef.current = accounts
  sessionsRef.current = sessions
  activeSessionIdRef.current = activeSessionId

  const acceptNotificationSnapshot = (snapshot: NotificationSnapshot): void => {
    setNotificationSnapshot((current) => snapshot.version >= current.version ? snapshot : current)
  }

  const resolvedAgentIcon = (agent: string): AgentIconPreference => {
    return agentIcons[agent] ?? { mode: 'monogram' }
  }
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
      if (activation.kind === 'delegation') {
        openDelegationTaskRef.current(activation.taskId)
        void window.cliAgent.acknowledgeSessionNotification(`delegation:${activation.taskId}`).then(acceptNotificationSnapshot)
        return
      }
      if (!sessionsRef.current.some((session) => session.id === activation.sessionId)) {
        setNotificationPanelOpen(true)
        return
      }
      const now = Date.now()
      setSessions((current) => current.map((session) => (
        session.id === activation.sessionId
          ? { ...session, view: 'cli', lastViewedAt: now, revealLatestAt: now }
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
    const acknowledgeFocusedSession = (): void => {
      if (document.visibilityState !== 'visible') return
      const session = sessionsRef.current.find((item) => item.id === activeSessionIdRef.current)
      if (!session || session.view !== 'cli') return
      void window.cliAgent.acknowledgeSessionNotification(session.id).then(acceptNotificationSnapshot)
    }
    window.addEventListener('focus', acknowledgeFocusedSession)
    document.addEventListener('visibilitychange', acknowledgeFocusedSession)
    return () => {
      window.removeEventListener('focus', acknowledgeFocusedSession)
      document.removeEventListener('visibilitychange', acknowledgeFocusedSession)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    void window.cliAgent.getSearchIndexState().then((state) => {
      if (mounted) setSearchIndexState(state)
    })
    const offChanged = window.cliAgent.onSearchIndexChanged((state) => {
      if (mounted) setSearchIndexState(state)
    })
    return () => {
      mounted = false
      offChanged()
    }
  }, [])

  useEffect(() => {
    const query = historyQuery.trim()
    const requestId = ++searchRequestId.current
    if (query.length < 2) {
      setSearchResults([])
      setSearchLoading(false)
      setSearchError('')
      return undefined
    }

    setSearchLoading(true)
    setSearchError('')
    const timer = window.setTimeout(() => {
      void window.cliAgent.searchConversations(query).then((response) => {
        if (searchRequestId.current !== requestId) return
        setSearchResults(response.results)
        setSearchIndexState(response.index)
      }).catch((error: unknown) => {
        if (searchRequestId.current !== requestId) return
        setSearchError(error instanceof Error ? error.message : String(error))
      }).finally(() => {
        if (searchRequestId.current === requestId) setSearchLoading(false)
      })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [historyQuery, searchIndexState.phase, searchIndexState.lastUpdatedAt])

  useEffect(() => {
    const reconcileProfiles = (): void => {
      if (document.visibilityState === 'visible') refreshProfiles()
    }
    const timer = window.setInterval(reconcileProfiles, 5 * 60_000)
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

  useEffect(() => {
    const claimedHistoryKeys = new Set(sessions.map((session) => session.historyKey).filter(Boolean))
    const availableHistory = history.filter((item) => !claimedHistoryKeys.has(item.key))
    const assignments: Record<string, string> = {}
    let changed = false
    const nextSessions = [...sessions]
      .sort((left, right) => right.createdAt - left.createdAt)
      .reduce<RuntimeSession[]>((result, session) => {
        if (session.purpose !== 'session' || session.historyKey || session.agentId === 'powershell') {
          result.push(session)
          return result
        }
        const sessionCwd = normalizedWorkingDirectory(session.cwd)
        const matchIndex = availableHistory
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => (
            !session.historyKeysAtStart.includes(item.key)
            && item.agentId === session.agentId
            && normalizedWorkingDirectory(item.cwd) === sessionCwd
            && (!session.account?.id || item.accountId === session.account.id)
          ))
          .sort((left, right) => (
            Math.abs(left.item.updatedAt - session.createdAt) - Math.abs(right.item.updatedAt - session.createdAt)
          ))[0]?.index ?? -1
        if (matchIndex < 0) {
          result.push(session)
          return result
        }
        const [match] = availableHistory.splice(matchIndex, 1)
        claimedHistoryKeys.add(match.key)
        assignments[match.key] = session.folderId
        changed = true
        result.push({ ...session, historyKey: match.key, resumeId: session.resumeId || match.resumeId })
        return result
      }, [])
      .sort((left, right) => left.createdAt - right.createdAt)

    if (!changed) return
    setSessions(nextSessions)
    setFolderAssignments((current) => ({ ...current, ...assignments }))
  }, [history, sessions])

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === agentId),
    [profiles, agentId],
  )
  const profilesById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  )
  const historyByKey = useMemo(
    () => new Map(history.map((session) => [session.key, session])),
    [history],
  )
  const notificationsBySessionId = useMemo(
    () => new Map(notificationSnapshot.notifications.map((notification) => [notification.sessionId, notification])),
    [notificationSnapshot.notifications],
  )
  const folderViews = useMemo(() => buildFolderViews({
    folders,
    sessions,
    history,
    assignments: folderAssignments,
    orders: folderOrders,
  }), [folderAssignments, folderOrders, folders, history, sessions])
  const agentAccounts = useMemo(
    () => accounts.filter((account) => account.agentId === agentId),
    [accounts, agentId],
  )
  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === accountId),
    [accounts, accountId],
  )
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [sessions, activeSessionId],
  )
  const activeSessionMuted = notificationSnapshot.mutedSessionIds.includes(activeSessionId)
  const activeProfile = activeSession ? profilesById.get(activeSession.agentId) : undefined
  const filteredHistory = history
  const accentOption = ACCENT_OPTIONS.find((option) => option.id === theme) ?? ACCENT_OPTIONS[0]
  const terminalFont = terminalFontFamily(appearance.terminalFont, appearance.localTerminalFont)
  const statusAwareAgents = useMemo(
    () => new Set(profiles.filter((profile) => profile.attention.status === 'supported').map((profile) => profile.id)),
    [profiles],
  )
  const themeStyle = useMemo(() => ({
    '--acc': accentOption.color,
    '--acc-ink': accentOption.ink,
    '--app-bg': appearance.appBackground,
    '--app-fg': appearance.appForeground,
    '--terminal-bg': appearance.terminalBackground,
    '--ui-font': uiFontFamily(appearance.uiFont, appearance.localUiFont),
  }) as CSSProperties, [accentOption, appearance])

  useEffect(() => {
    window.cliAgent.updateNotificationContext({
      activeSessionId,
      activeView: activeSession?.view ?? 'none',
    })
  }, [activeSessionId, activeSession?.view])

  const updateSession = (id: string, update: Partial<RuntimeSession>): void => {
    setSessions((current) => current.map((session) => session.id === id ? { ...session, ...update } : session))
  }
  const olderMessagesInFlight = useRef(new Set<string>())

  const recordSessionActivity = (id: string): void => {
    sessionActivityTimesRef.current.set(id, Date.now())
  }

  const revealSessionFolder = (session: RuntimeSession): void => {
    const folderId = folders.some((folder) => folder.id === session.folderId) ? session.folderId : 'unsorted'
    setSectionOpen((current) => {
      if (current.folders) return current
      const next = { ...current, folders: true }
      localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(next))
      return next
    })
    setSelectedFolderId(folderId)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        folderSessionRefs.current.get(session.id)?.scrollIntoView({ block: 'nearest' })
      })
    })
  }

  const addRuntimeSession = (session: Omit<RuntimeSession, 'id' | 'createdAt' | 'lastViewedAt' | 'lastActivityAt'>): string => {
    const id = crypto.randomUUID()
    const now = Date.now()
    sessionActivityTimesRef.current.set(id, now)
    const nextSession: RuntimeSession = {
      ...session,
      id,
      createdAt: now,
      lastViewedAt: now,
      lastActivityAt: now,
      revealLatestAt: session.view === 'cli' ? now : session.revealLatestAt,
    }
    setSessions((current) => {
      const overflow = current.length - maxRuntimeSessions + 1
      if (overflow <= 0) return [...current, nextSession]
      const victims = [...current]
        .sort((left, right) => {
          if (left.id === activeSessionId) return 1
          if (right.id === activeSessionId) return -1
          return left.lastViewedAt - right.lastViewedAt
        })
        .slice(0, overflow)
      const victimIds = new Set(victims.map((item) => item.id))
      for (const victim of victims) sessionActivityTimesRef.current.delete(victim.id)
      return [...current.filter((item) => !victimIds.has(item.id)), nextSession]
    })
    setActiveSessionId(id)
    return id
  }

  const activateSession = (id: string, revealFolder = false): void => {
    const targetSession = sessionsRef.current.find((session) => session.id === id)
    if (revealFolder && targetSession) revealSessionFolder(targetSession)
    const now = Date.now()
    setSessions((current) => current.map((session) => {
      if (session.id === id) {
        return {
          ...session,
          lastViewedAt: now,
          lastActivityAt: sessionActivityTimesRef.current.get(id) ?? session.lastActivityAt,
        }
      }
      return session.id === activeSessionId ? { ...session, lastViewedAt: now } : session
    }))
    setActiveSessionId(id)
    void window.cliAgent.acknowledgeSessionNotification(id).then(acceptNotificationSnapshot)
  }
  activateSessionRef.current = activateSession

  const openSessionLauncher = (): void => {
    setNewSessionFolderId('unsorted')
    setLauncherOpen(true)
  }

  const reorderSessionTabs = (next: RuntimeSession[]): void => {
    sessionsRef.current = next
    setSessions(next)
  }

  const closeSession = (id: string): void => {
    const currentSessions = sessionsRef.current
    const closedIndex = currentSessions.findIndex((session) => session.id === id)
    const remainingSessions = currentSessions.filter((session) => session.id !== id)
    const adjacentSessionId = remainingSessions[Math.min(Math.max(0, closedIndex), remainingSessions.length - 1)]?.id ?? ''
    sessionActivityTimesRef.current.delete(id)
    sessionsRef.current = remainingSessions
    setSessions(remainingSessions)
    setActiveSessionId((current) => current === id ? adjacentSessionId : current)
    void window.cliAgent.acknowledgeSessionNotification(id).then(acceptNotificationSnapshot)
    void window.cliAgent.setSessionNotificationMuted(id, false).then(acceptNotificationSnapshot)
  }

  const restartSession = (id: string): void => {
    const session = sessionsRef.current.find((item) => item.id === id)
    if (!session || session.state === 'starting') return
    const historyResumeId = history.find((item) => item.key === session.historyKey)?.resumeId ?? ''
    const resumeId = session.resumeId || historyResumeId
    if (session.purpose === 'session' && session.agentId !== 'powershell' && !resumeId) return

    const now = Date.now()
    sessionActivityTimesRef.current.set(id, now)
    updateSession(id, {
      resumeId,
      terminalEnabled: true,
      terminalRevision: session.terminalRevision + 1,
      state: 'starting',
      statusDetail: 'Restarting CLI session',
      view: 'cli',
      revealLatestAt: now,
      lastActivityAt: now,
    })
    void window.cliAgent.acknowledgeSessionNotification(id).then(acceptNotificationSnapshot)
    refreshProfiles()
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
      folderId: newSessionFolderId || 'unsorted',
      historyKey: '',
      historyKeysAtStart: history.map((item) => item.key),
      conversation: null,
      conversationLoading: false,
      conversationLoadingOlder: false,
      conversationError: '',
      terminalEnabled: true,
      terminalRevision: 0,
      highlightMessageId: '',
      state: 'idle',
      statusDetail: '',
      view: 'cli',
      revealLatestAt: 0,
    })
    setTitle('')
    setNewSessionFolderId('unsorted')
    setLauncherOpen(false)
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
        session.id === activeSessionId
        || notifiedSessionIds.has(session.id)
        || session.lastViewedAt >= cutoff
        // A session whose terminal is still producing or receiving output is
        // in use even when it has not been viewed — never sweep active work.
        || (sessionActivityTimesRef.current.get(session.id) ?? session.lastActivityAt) >= cutoff
      )))
    }, SESSION_SWEEP_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [activeSessionId, notificationSnapshot.notifications])

  useEffect(() => {
    let mounted = true
    void window.cliAgent.isWindowMaximized().then((maximized) => {
      if (mounted) setWindowMaximized(maximized)
    })
    const offMaximized = window.cliAgent.onWindowMaximizedChanged(setWindowMaximized)
    return () => {
      mounted = false
      offMaximized()
    }
  }, [])

  useEffect(() => {
    const adjustTerminalFontSize = (delta: number): void => {
      setAppearance((current) => {
        const nextSize = delta === 0
          ? DEFAULT_APPEARANCE.terminalFontSize
          : Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, current.terminalFontSize + delta))
        window.clearTimeout(zoomNoticeTimer.current)
        setZoomNotice(nextSize)
        zoomNoticeTimer.current = window.setTimeout(() => setZoomNotice(null), 1200)
        if (nextSize === current.terminalFontSize) return current
        const next = { ...current, terminalFontSize: nextSize }
        saveAppearance(next)
        return next
      })
    }
    const onZoomKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return
      const delta = event.key === '=' || event.key === '+'
        ? 1
        : event.key === '-' || event.key === '_'
          ? -1
          : event.key === '0' ? 0 : null
      if (delta === null) return
      event.preventDefault()
      adjustTerminalFontSize(delta)
    }
    let lastWheelZoomAt = 0
    const onZoomWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey || event.deltaY === 0) return
      event.preventDefault()
      const now = performance.now()
      if (now - lastWheelZoomAt < 60) return
      lastWheelZoomAt = now
      adjustTerminalFontSize(event.deltaY < 0 ? 1 : -1)
    }
    window.addEventListener('keydown', onZoomKeyDown)
    window.addEventListener('wheel', onZoomWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onZoomKeyDown)
      window.removeEventListener('wheel', onZoomWheel)
      window.clearTimeout(zoomNoticeTimer.current)
    }
  }, [])

  useEffect(() => {
    const onTabShortcut = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return
      const list = sessionsRef.current
      if (event.key === 'Tab') {
        event.preventDefault()
        if (list.length < 2) return
        const index = list.findIndex((session) => session.id === activeSessionIdRef.current)
        const next = list[(index + (event.shiftKey ? -1 : 1) + list.length) % list.length]
        if (next) activateSessionRef.current(next.id)
        return
      }
      if (!event.shiftKey && /^[1-9]$/.test(event.key)) {
        if (!list.length) return
        const target = event.key === '9' ? list[list.length - 1] : list[Number(event.key) - 1]
        if (!target) return
        event.preventDefault()
        activateSessionRef.current(target.id)
      }
    }
    window.addEventListener('keydown', onTabShortcut)
    return () => window.removeEventListener('keydown', onTabShortcut)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.code === 'KeyK') {
        event.preventDefault()
        setSearchOpen(true)
        window.requestAnimationFrame(() => searchRef.current?.focus())
      }
      if (event.key === 'Escape' && searchOpen) {
        event.preventDefault()
        setSearchOpen(false)
        setHistoryQuery('')
      } else if (event.key === 'Escape' && launcherOpen) {
        event.preventDefault()
        setLauncherOpen(false)
      }
      if (event.ctrlKey && event.key === 'Enter' && (launcherOpen || !activeSession)) {
        event.preventDefault()
        startSession()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeSession, agentId, cwd, title, selectedAccount, newSessionFolderId, searchOpen, launcherOpen])

  const toggleSection = (section: SidebarSectionKey): void => {
    setSectionOpen((current) => {
      const next = { ...current, [section]: !current[section] }
      localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(next))
      return next
    })
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

  const changeMaxRuntimeSessions = (value: number): void => {
    const next = Math.min(MAX_RUNTIME_SESSIONS_LIMIT, Math.max(MIN_RUNTIME_SESSIONS, Math.round(value)))
    setMaxRuntimeSessions(next)
    localStorage.setItem(MAX_RUNTIME_SESSIONS_STORAGE_KEY, String(next))
  }

  const changeNotificationSettings = (update: Partial<NotificationSettings>): void => {
    void window.cliAgent.updateNotificationSettings(update).then((snapshot) => {
      acceptNotificationSnapshot(snapshot)
      if (!snapshot.settings.enabled) setNotificationPanelOpen(false)
    })
  }

  useEffect(() => {
    let mounted = true
    void window.cliAgent.getDelegationSnapshot().then((snapshot) => {
      if (mounted) setDelegationSnapshot(snapshot)
    }).catch(() => undefined)
    const offChanged = window.cliAgent.onDelegationChanged(setDelegationSnapshot)
    return () => {
      mounted = false
      offChanged()
    }
  }, [])

  const awaitingDelegations = delegationSnapshot?.tasks.filter((task) => task.status === 'awaiting_approval') ?? []
  const pendingApproval = awaitingDelegations.find((task) => task.id === focusedApprovalId)
    ?? awaitingDelegations.find((task) => !dismissedApprovalIds.has(task.id))

  const openDelegationTask = (taskId: string): void => {
    const task = delegationSnapshot?.tasks.find((item) => item.id === taskId)
    if (task?.status === 'awaiting_approval') {
      setDismissedApprovalIds((current) => {
        if (!current.has(taskId)) return current
        const next = new Set(current)
        next.delete(taskId)
        return next
      })
      setFocusedApprovalId(taskId)
      setApprovalError('')
      return
    }
    setSettingsSection('delegation')
    setSettingsOpen(true)
  }
  openDelegationTaskRef.current = openDelegationTask

  const dismissApproval = (): void => {
    if (!pendingApproval) return
    const taskId = pendingApproval.id
    setDismissedApprovalIds((current) => new Set(current).add(taskId))
    setFocusedApprovalId('')
    setApprovalError('')
  }

  const runDelegationAction = (action: () => Promise<DelegationSnapshot>): void => {
    setApprovalBusy(true)
    setApprovalError('')
    void action().then((snapshot) => {
      setDelegationSnapshot(snapshot)
      setFocusedApprovalId('')
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      setApprovalError(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''))
    }).finally(() => setApprovalBusy(false))
  }
  const acknowledgeDelegationNotification = (taskId: string): void => {
    void window.cliAgent.acknowledgeSessionNotification(`delegation:${taskId}`).then(acceptNotificationSnapshot)
  }
  const approveDelegation = (taskId: string, account?: AgentAccount): void => {
    runDelegationAction(() => window.cliAgent.approveDelegation(account ? { taskId, account } : { taskId }))
    acknowledgeDelegationNotification(taskId)
  }
  const rejectDelegation = (taskId: string): void => {
    runDelegationAction(() => window.cliAgent.rejectDelegation(taskId))
    acknowledgeDelegationNotification(taskId)
  }
  const cancelDelegation = (taskId: string): void => {
    runDelegationAction(() => window.cliAgent.cancelDelegation(taskId))
    acknowledgeDelegationNotification(taskId)
  }
  const setDelegationEnabled = (enabled: boolean): void => {
    runDelegationAction(() => window.cliAgent.setDelegationEnabled(enabled))
  }
  const setDelegationAutoApprove = (enabled: boolean): void => {
    runDelegationAction(() => window.cliAgent.setDelegationAutoApprove(enabled))
  }
  const regenerateDelegationToken = (): void => {
    runDelegationAction(() => window.cliAgent.regenerateDelegationToken())
  }

  const openNotification = (notification: AppNotification): void => {
    if (notification.sessionId.startsWith('delegation:')) {
      openDelegationTask(notification.sessionId.slice('delegation:'.length))
      setNotificationPanelOpen(false)
      void window.cliAgent.acknowledgeSessionNotification(notification.sessionId).then(acceptNotificationSnapshot)
      return
    }
    if (!sessionsRef.current.some((session) => session.id === notification.sessionId)) {
      void window.cliAgent.dismissNotification(notification.id).then(acceptNotificationSnapshot)
      return
    }
    const now = Date.now()
    updateSession(notification.sessionId, { view: 'cli', lastViewedAt: now, revealLatestAt: now })
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
    const position = calculateColorPickerPosition(rect, { width: window.innerWidth, height: window.innerHeight })

    setAgentColorDraft(color.toUpperCase())
    setAgentColorPicker({ agentId, ...position })
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

  const renameFolder = (folderId: string, name: string): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    setFolders((items) => items.map((folder) => folder.id === folderId ? { ...folder, name: trimmed } : folder))
  }

  const removeFolder = (folderId: string): void => {
    if (folderId === 'unsorted') return
    setFolders((items) => items.filter((folder) => folder.id !== folderId))
    setFolderAssignments((current) => Object.fromEntries(
      Object.entries(current).map(([key, value]) => [key, value === folderId ? 'unsorted' : value]),
    ))
    setSessions((current) => current.map((session) => (
      session.folderId === folderId ? { ...session, folderId: 'unsorted' } : session
    )))
    setFolderOrders((current) => {
      if (!(folderId in current)) return current
      const next = { ...current }
      const orphaned = next[folderId] ?? []
      delete next[folderId]
      next.unsorted = [...(next.unsorted ?? []), ...orphaned.filter((key) => !(next.unsorted ?? []).includes(key))]
      return next
    })
    setSelectedFolderId((current) => current === folderId ? 'unsorted' : current)
    setNewSessionFolderId((current) => current === folderId ? 'unsorted' : current)
  }

  const openAccountSettings = (): void => {
    setDraftAccounts(accountsRef.current)
    setAccountSaveNotice(null)
    setNotificationPanelOpen(false)
    setSettingsSection('accounts')
    setSettingsOpen(true)
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
    const targetFolderId = folderAssignments[historySession.key] || 'unsorted'
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
      historyKeysAtStart: [],
      conversation: null,
      conversationLoading: false,
      conversationLoadingOlder: false,
      conversationError: '',
      terminalEnabled: true,
      terminalRevision: 0,
      highlightMessageId: '',
      state: 'idle',
      statusDetail: '',
      view: 'cli',
      revealLatestAt: 0,
    })
  }

  const mergeOlderMessages = (
    current: NonNullable<RuntimeSession['conversation']>,
    older: NonNullable<RuntimeSession['conversation']>,
  ): NonNullable<RuntimeSession['conversation']> => ({
    session: current.session,
    messages: [...older.messages, ...current.messages],
    ...(older.olderCursor === undefined ? {} : { olderCursor: older.olderCursor }),
  })

  const loadConversation = (id: string, historyKey: string, highlightMessageId = ''): void => {
    updateSession(id, { conversationLoading: true, conversationLoadingOlder: false, conversationError: '', highlightMessageId })
    // A search hit can sit far above the most recent page, so keep paging
    // back until it is loaded and the highlight has something to scroll to.
    const loadUntilHighlighted = async (): Promise<NonNullable<RuntimeSession['conversation']>> => {
      let conversation = await window.cliAgent.getConversation(historyKey)
      while (
        highlightMessageId
        && conversation.olderCursor !== undefined
        && !conversation.messages.some((message) => message.id === highlightMessageId)
      ) {
        conversation = mergeOlderMessages(conversation, await window.cliAgent.getConversation(historyKey, conversation.olderCursor))
      }
      return conversation
    }
    void loadUntilHighlighted().then((conversation) => {
      updateSession(id, { conversation, conversationLoading: false, highlightMessageId })
    }).catch((error: unknown) => {
      updateSession(id, {
        conversationLoading: false,
        conversationError: error instanceof Error ? error.message : String(error),
      })
    })
  }

  const loadOlderMessages = (id: string, before: number): void => {
    const session = sessions.find((item) => item.id === id)
    if (!session?.historyKey || olderMessagesInFlight.current.has(id)) return
    olderMessagesInFlight.current.add(id)
    updateSession(id, { conversationLoadingOlder: true })
    void window.cliAgent.getConversation(session.historyKey, before).then((older) => {
      setSessions((current) => current.map((item) => (
        item.id === id && item.conversation
          ? { ...item, conversation: mergeOlderMessages(item.conversation, older), conversationLoadingOlder: false }
          : item
      )))
    }).catch(() => {
      updateSession(id, { conversationLoadingOlder: false })
    }).finally(() => {
      olderMessagesInFlight.current.delete(id)
    })
  }

  const showConversation = (id: string, highlightMessageId = ''): void => {
    const session = sessions.find((item) => item.id === id)
    if (!session?.historyKey) return
    updateSession(id, { view: 'conversation', highlightMessageId })
    if (session.conversationLoading) return
    const loaded = session.conversation
    // Reload only when a search hit points below the pages already loaded.
    const highlightLoaded = !highlightMessageId
      || loaded?.messages.some((message) => message.id === highlightMessageId)
      || loaded?.olderCursor === undefined
    if (loaded && highlightLoaded) return
    loadConversation(id, session.historyKey, highlightMessageId)
  }

  const showCli = (id: string): void => {
    updateSession(id, { view: 'cli', terminalEnabled: true, highlightMessageId: '' })
  }

  const openSearchResult = (result: ConversationSearchResult): void => {
    const existing = sessions.find((session) => session.historyKey === result.session.key)
    if (existing) {
      activateSession(existing.id)
      showConversation(existing.id, result.messageId)
      setSearchOpen(false)
      setHistoryQuery('')
      return
    }

    const account = accounts.find((item) => item.id === result.session.accountId)
    const id = addRuntimeSession({
      agentId: result.session.agentId,
      cwd: result.session.cwd || cwd.trim() || 'C:\\git_workspace',
      title: result.session.title,
      account,
      purpose: 'session',
      resumeId: result.session.resumeId,
      folderId: folderAssignments[result.session.key] || 'unsorted',
      historyKey: result.session.key,
      historyKeysAtStart: [],
      conversation: null,
      conversationLoading: true,
      conversationLoadingOlder: false,
      conversationError: '',
      terminalEnabled: false,
      terminalRevision: 0,
      highlightMessageId: result.messageId,
      state: 'idle',
      statusDetail: 'Conversation opened from search',
      view: 'conversation',
      revealLatestAt: 0,
    })
    loadConversation(id, result.session.key, result.messageId)
    setSearchOpen(false)
    setHistoryQuery('')
  }

  const rebuildConversationSearch = (): void => {
    if (searchRebuilding) return
    setSearchRebuilding(true)
    setSearchError('')
    void window.cliAgent.rebuildSearchIndex(accountsRef.current).then((state) => {
      setSearchIndexState(state)
    }).catch((error: unknown) => {
      setSearchError(error instanceof Error ? error.message : String(error))
    }).finally(() => setSearchRebuilding(false))
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
      historyKeysAtStart: [],
      conversation: null,
      conversationLoading: false,
      conversationLoadingOlder: false,
      conversationError: '',
      terminalEnabled: true,
      terminalRevision: 0,
      highlightMessageId: '',
      state: 'idle',
      statusDetail: '',
      view: 'cli',
      revealLatestAt: 0,
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

  const launcherElement = (
    <SessionLauncher
      profiles={profiles}
      agentId={agentId}
      agentIcons={agentIcons}
      title={title}
      cwd={cwd}
      folders={folders}
      folderId={newSessionFolderId}
      accountId={accountId}
      accounts={agentAccounts}
      selectedProfile={selectedProfile}
      selectedAccount={selectedAccount}
      onAgentChange={setAgentId}
      onTitleChange={setTitle}
      onSelectWorkingDirectory={selectWorkingDirectory}
      onFolderChange={setNewSessionFolderId}
      onAccountChange={setAccountId}
      onStart={startSession}
      onOpenAccountSettings={openAccountSettings}
    />
  )

  return (
    <main className={`app-shell ${windowMaximized ? 'maximized' : ''}`} data-theme={theme} style={themeStyle}>
      <AppTitlebar
        sidebarCollapsed={sidebarCollapsed}
        maximized={windowMaximized}
        notificationsEnabled={notificationSnapshot.settings.enabled}
        notificationCount={notificationSnapshot.notifications.length}
        notificationPanelOpen={notificationPanelOpen}
        onToggleNotifications={() => setNotificationPanelOpen((current) => !current)}
        onOpenSettings={() => {
          setDraftAccounts(accounts)
          setAccountSaveNotice(null)
          setNotificationPanelOpen(false)
          setSettingsOpen(true)
        }}
        onToggleSidebar={toggleSidebar}
        onMinimize={() => window.cliAgent.minimizeWindow()}
        onToggleMaximize={() => window.cliAgent.toggleMaximizeWindow()}
        onClose={() => window.cliAgent.closeWindow()}
      />

      <div className={`app-body ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} ref={appBodyRef} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
        <AppSidebar
          collapsed={sidebarCollapsed}
          sections={sectionOpen}
          folders={folders}
          folderViews={folderViews}
          selectedFolderId={selectedFolderId}
          newFolderName={newFolderName}
          draggedItem={draggedSidebarItem}
          dragOverFolderId={dragOverFolderId}
          dropIndicator={folderDropIndicator}
          removingEntry={removingFolderEntry}
          activeSessionId={activeSessionId}
          activeHistoryKey={activeSession?.historyKey ?? ''}
          filteredHistory={filteredHistory}
          folderAssignments={folderAssignments}
          profiles={profiles}
          profilesById={profilesById}
          profilesRefreshing={profilesRefreshing}
          notificationsBySessionId={notificationsBySessionId}
          sidebarWidth={sidebarWidth}
          folderPaneHeight={folderPaneHeight}
          sidebarWidthRange={sidebarWidthRange}
          folderPaneHeightRange={folderPaneHeightRange}
          folderTreeRef={folderTreeRef}
          folderSessionRefs={folderSessionRefs}
          resolvedAgentIcon={resolvedAgentIcon}
          onOpenSearch={() => {
            setSearchOpen(true)
            window.requestAnimationFrame(() => searchRef.current?.focus())
          }}
          onToggleSection={toggleSection}
          onNewFolder={() => setNewFolderName('')}
          onNewSession={openSessionLauncher}
          onRenameFolder={renameFolder}
          onRemoveFolder={removeFolder}
          onOpenAccountSettings={openAccountSettings}
          onToggleFolder={(folderId) => setSelectedFolderId((current) => current === folderId ? '' : folderId)}
          onFolderDragEnter={setDragOverFolderId}
          onFolderDragLeave={() => {
            setDragOverFolderId('')
            setFolderDropIndicator(null)
          }}
          onFolderDragOver={(event, folderId) => {
            if (!draggedSidebarItem) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            if (dragOverFolderId !== folderId) setDragOverFolderId(folderId)
            if (folderDropIndicator) setFolderDropIndicator(null)
          }}
          onDropIntoFolder={dropIntoFolder}
          onStartItemDrag={startSidebarDrag}
          onFinishItemDrag={finishSidebarDrag}
          onDragOverEntry={dragOverFolderEntry}
          onDropByEntry={dropByFolderEntry}
          onActivateSession={activateSession}
          onCloseSession={closeFolderSession}
          onResumeConversation={resumeConversation}
          onRemoveHistory={removeHistoryFromFolder}
          onNewFolderNameChange={setNewFolderName}
          onAddFolder={addFolder}
          onCancelNewFolder={() => setNewFolderName(null)}
          onRefreshHistory={() => refreshHistory()}
          onRefreshProfiles={refreshProfiles}
          onBeginFolderPaneResize={beginFolderPaneResize}
          onResetFolderPaneHeight={resetFolderPaneHeight}
          onResizeFolderPaneWithKeyboard={resizeFolderPaneWithKeyboard}
          onBeginSidebarResize={beginSidebarResize}
          onResetSidebarWidth={resetSidebarWidth}
          onResizeSidebarWithKeyboard={resizeSidebarWithKeyboard}
        />

        <section className="workspace">
          <div className="content-stage">
            {sessions.length > 0 && (
              <div className="session-chrome">
                <Suspense fallback={<nav className="session-tabs scroll" aria-label="Open sessions" />}>
                  <LazySessionTabs
                    sessions={sessions}
                    activeSessionId={activeSessionId}
                    profilesById={profilesById}
                    notificationsBySessionId={notificationsBySessionId}
                    historyByKey={historyByKey}
                    agentIcons={agentIcons}
                    onActivate={(sessionId) => activateSession(sessionId, true)}
                    onRestart={restartSession}
                    onClose={closeSession}
                    onReorder={reorderSessionTabs}
                    onNewSession={openSessionLauncher}
                  />
                </Suspense>
                {activeSession && (
                  <SessionHeader
                    session={activeSession}
                    profileColor={activeProfile?.color ?? '#7e878d'}
                    iconPreference={resolvedAgentIcon(activeSession.agentId)}
                    loginRefreshing={loginAccountRefreshing === activeSession.id}
                    notificationsEnabled={notificationSnapshot.settings.enabled}
                    muted={activeSessionMuted}
                    onRefreshAccount={() => refreshLoginAccount(activeSession)}
                    onToggleMuted={() => toggleSessionNotificationMute(activeSession.id, !activeSessionMuted)}
                    onShowCli={() => showCli(activeSession.id)}
                    onShowConversation={() => showConversation(activeSession.id)}
                  />
                )}
              </div>
            )}
            {!activeSession && !sessions.length && launcherElement}
            <SessionRuntimeStage
              sessions={sessions}
              activeSessionId={activeSessionId}
              terminalFontFamily={terminalFont}
              terminalFontSize={appearance.terminalFontSize}
              terminalRenderer={appearance.terminalRenderer}
              terminalBackground={appearance.terminalBackground}
              terminalForeground={appearance.terminalForeground}
              cursorColor={accentOption.color}
              statusAwareAgents={statusAwareAgents}
              onOpenExternal={window.cliAgent.openExternal}
              onLoadOlderMessages={loadOlderMessages}
              onActivity={recordSessionActivity}
              onStateChange={(sessionId, state, detail) => updateSession(sessionId, { state, statusDetail: detail ?? '' })}
            />
            {zoomNotice !== null && (
              <div className="zoom-notice" role="status">Terminal {zoomNotice}px</div>
            )}
          </div>

          <StatusBar
            activeSession={activeSession}
            activeProfileVersion={activeProfile?.version}
            openSessionCount={sessions.length}
            maximumSessionCount={maxRuntimeSessions}
            update={appUpdate}
            updateOpening={updateOpening}
            detectedVersions={detectedVersions}
            getLastActivityAt={() => activeSession
              ? sessionActivityTimesRef.current.get(activeSession.id) ?? activeSession.lastActivityAt
              : 0}
            onOpenUpdate={() => void openAppUpdateDownload()}
          />
        </section>
      </div>

      {launcherOpen && sessions.length > 0 && (
        <div
          className="launcher-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLauncherOpen(false)
          }}
        >
          <section className="launcher-modal" role="dialog" aria-modal="true" aria-label="Start a new session">
            <button className="icon-button launcher-modal-close" title="Close (Esc)" onClick={() => setLauncherOpen(false)}>
              <X size={15} />
            </button>
            {launcherElement}
          </section>
        </div>
      )}

      {searchOpen && (
        <ConversationSearchModal
          inputRef={searchRef}
          query={historyQuery}
          results={searchResults}
          indexState={searchIndexState}
          loading={searchLoading}
          error={searchError}
          rebuilding={searchRebuilding}
          profilesById={profilesById}
          agentIcons={agentIcons}
          onQueryChange={setHistoryQuery}
          onClose={() => {
            setSearchOpen(false)
            setHistoryQuery('')
          }}
          onRebuild={rebuildConversationSearch}
          onOpenResult={openSearchResult}
        />
      )}

      <NotificationCenter
        snapshot={notificationSnapshot}
        open={notificationPanelOpen}
        profilesById={profilesById}
        agentIcons={agentIcons}
        onClose={() => setNotificationPanelOpen(false)}
        onClear={() => void window.cliAgent.clearNotifications().then(acceptNotificationSnapshot)}
        onOpen={openNotification}
        onDismiss={(notificationId) => void window.cliAgent.dismissNotification(notificationId).then(acceptNotificationSnapshot)}
      />

      {settingsOpen && (
        <SettingsModal
          section={settingsSection}
          theme={theme}
          appearance={appearance}
          maximumTabs={maxRuntimeSessions}
          minimumTabs={MIN_RUNTIME_SESSIONS}
          maximumTabsLimit={MAX_RUNTIME_SESSIONS_LIMIT}
          localFonts={localFonts}
          localFontStatus={localFontStatus}
          appVersion={appVersion}
          update={appUpdate}
          updateChecking={updateChecking}
          updateOpening={updateOpening}
          updateError={updateError}
          notificationSettings={notificationSnapshot.settings}
          delegation={delegationSnapshot}
          profiles={profiles}
          profilesById={profilesById}
          agentIcons={agentIcons}
          draftAccounts={draftAccounts}
          accountSaveNotice={accountSaveNotice}
          resolvedAgentIcon={resolvedAgentIcon}
          onClose={() => setSettingsOpen(false)}
          onSectionChange={(nextSection) => {
            setSettingsSection(nextSection)
            if (nextSection === 'updates' && !appUpdate && !updateChecking) void checkAppUpdate()
          }}
          onThemeChange={changeTheme}
          onAppearanceChange={changeAppearance}
          onResetAppearance={() => {
            changeTheme('amber')
            changeAppearance(DEFAULT_APPEARANCE)
          }}
          onMaximumTabsChange={changeMaxRuntimeSessions}
          onDiscoverLocalFonts={discoverLocalFonts}
          onCheckUpdate={() => void checkAppUpdate(true)}
          onOpenUpdateDownload={() => void openAppUpdateDownload()}
          onNotificationSettingsChange={changeNotificationSettings}
          onDelegationEnabledChange={setDelegationEnabled}
          onDelegationAutoApproveChange={setDelegationAutoApprove}
          onRegenerateDelegationToken={regenerateDelegationToken}
          onReviewDelegation={openDelegationTask}
          onCancelDelegation={cancelDelegation}
          onAgentIconChange={changeAgentIcon}
          onOpenIconPicker={setIconPickerAgentId}
          onImportAgentIcon={importAgentIcon}
          onOpenAgentColorPicker={openAgentColorPicker}
          onAccountChange={(index, update) => {
            setAccountSaveNotice(null)
            setDraftAccounts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item))
          }}
          onAuthenticateAccount={authenticateAccount}
          onRemoveAccount={(index) => {
            setAccountSaveNotice(null)
            setDraftAccounts((current) => current.filter((_, itemIndex) => itemIndex !== index))
          }}
          onAddAccount={addAccount}
          onSaveAccounts={saveAccounts}
        />
      )}



      {pendingApproval && (
        <DelegationApprovalModal
          task={pendingApproval}
          accounts={accounts.filter((account) => account.agentId === pendingApproval.agent)}
          profilesById={profilesById}
          resolvedAgentIcon={resolvedAgentIcon}
          busy={approvalBusy}
          error={approvalError}
          onApprove={approveDelegation}
          onReject={rejectDelegation}
          onDismiss={dismissApproval}
        />
      )}

      {iconPickerAgentId && (
        <Suspense fallback={null}>
          <LazyLucideIconPicker
            agentLabel={profilesById.get(iconPickerAgentId)?.label ?? iconPickerAgentId}
            currentIconName={agentIcons[iconPickerAgentId]?.mode === 'lucide' ? agentIcons[iconPickerAgentId]?.iconName : undefined}
            onClose={() => setIconPickerAgentId('')}
            onSelect={(name) => {
              changeAgentIcon(iconPickerAgentId, { mode: 'lucide', iconName: name })
              setIconPickerAgentId('')
            }}
          />
        </Suspense>
      )}

      {agentColorPicker && (
        <AgentColorPickerPopover
          picker={agentColorPicker}
          agentLabel={colorPickerProfile?.label ?? agentColorPicker.agentId}
          activeColor={activeAgentColor}
          draft={agentColorDraft}
          hasCustomColor={Boolean(agentIcons[agentColorPicker.agentId]?.backgroundColor)}
          onClose={() => setAgentColorPicker(null)}
          onReset={() => {
            changeAgentIconBackground(agentColorPicker.agentId)
            setAgentColorDraft((colorPickerProfile?.color ?? '#56616B').toUpperCase())
          }}
          onDraftChange={(draft, completeColor) => {
            setAgentColorDraft(draft)
            if (completeColor) changeAgentIconBackground(agentColorPicker.agentId, completeColor)
          }}
          onSelect={selectAgentColor}
        />
      )}
    </main>
  )
}

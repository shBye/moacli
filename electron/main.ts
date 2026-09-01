import { join } from 'node:path'
import { existsSync, mkdirSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell } from 'electron'
import { getAgentHealth } from './agent-profiles'
import { checkForAppUpdate, downloadAppUpdate } from './app-updates'
import { AttentionBridge } from './attention-bridge'
import { DelegationServer } from './delegation-server'
import { DelegationTaskRegistry } from './delegation-tasks'
import type { AgentAccount, DelegationApproval, DelegationSnapshot, NotificationContext, NotificationSettings, SearchIndexState, StartPtyRequest } from './contracts'
import { HistoryHostClient } from './history-host-client'
import { NotificationCenter } from './notification-center'
import { PtyHostClient } from './pty-host-client'

let mainWindow: BrowserWindow | null = null
app.setPath('userData', join(app.getPath('appData'), 'cli-agent-manager'))
if (process.platform === 'win32') app.setAppUserModelId('app.moacli.desktop')
let notificationCenter: NotificationCenter | null = null
const attentionBridge = new AttentionBridge(({ request, source, reason, generation }) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pty:attention', { id: request.id, reason })
  }
  notificationCenter?.handleNeedsAttention(request, `${source}:${reason}:${generation}`)
})
const ptyHost = new PtyHostClient(
  join(__dirname, 'pty-host.js'),
  () => mainWindow?.webContents ?? null,
  attentionBridge,
  ({ request, exitCode, intentional }) => notificationCenter?.handleExit(request, exitCode, intentional),
)
const sessionHistory = new HistoryHostClient(
  join(__dirname, 'history-host.js'),
  (state: SearchIndexState) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('search:index-changed', state)
  },
)
let delegationServer: DelegationServer | null = null
let delegationRegistry: DelegationTaskRegistry | null = null
const historyWatchers = new Map<string, FSWatcher>()
let historyChangeTimer: ReturnType<typeof setTimeout> | undefined
const HISTORY_CHANGE_DEBOUNCE_MS = 700
const HISTORY_CHANGE_BUSY_THROTTLE_MS = 5000
const CLIPBOARD_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

function delegationSnapshot(): DelegationSnapshot {
  return {
    server: delegationServer?.status() ?? {
      enabled: false, running: false, autoApprove: false, port: 0, url: '', token: '', claudeRegisterCommand: '', codexConfigSnippet: '', codexConfigPath: '',
    },
    tasks: delegationRegistry?.snapshot() ?? [],
  }
}

function emitDelegationChanged(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('delegation:changed', delegationSnapshot())
}

function delegationRegistryOrThrow(): DelegationTaskRegistry {
  if (!delegationRegistry) throw new Error('Delegation is not available')
  return delegationRegistry
}

function notifications(): NotificationCenter {
  if (!notificationCenter) throw new Error('Notification center is not ready')
  return notificationCenter
}

function readWindowsClipboardImageFiles(): Promise<string[]> {
  if (process.platform !== 'win32') return Promise.resolve([])

  const command = [
    "$paths = @(Get-Clipboard -Format FileDropList -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })",
    'ConvertTo-Json -InputObject $paths -Compress',
  ].join('; ')

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { encoding: 'utf8', timeout: 2000, windowsHide: true },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve([])
          return
        }
        try {
          const parsed: unknown = JSON.parse(stdout.replace(/^\uFEFF/, '').trim())
          const paths = Array.isArray(parsed) ? parsed : [parsed]
          resolve(paths.filter((value): value is string => (
            typeof value === 'string'
            && existsSync(value)
            && CLIPBOARD_IMAGE_EXTENSIONS.has(value.slice(value.lastIndexOf('.')).toLocaleLowerCase())
          )))
        } catch {
          resolve([])
        }
      },
    )
  })
}

function historyRoot(account: AgentAccount): string {
  if (account.agentId === 'claude') return join(account.configDir, 'projects')
  if (account.agentId === 'codex') return join(account.configDir, 'sessions')
  if (account.agentId === 'gemini') return join(account.configDir, 'tmp')
  return account.configDir
}

function scheduleHistoryChanged(): void {
  if (historyChangeTimer) return
  // Live agent sessions append to their transcripts continuously; the history
  // list does not need to track that in near real time, so throttle hard while
  // any session runs and stay responsive when the change comes from elsewhere.
  const delay = ptyHost.liveSessionCount > 0 ? HISTORY_CHANGE_BUSY_THROTTLE_MS : HISTORY_CHANGE_DEBOUNCE_MS
  historyChangeTimer = setTimeout(() => {
    historyChangeTimer = undefined
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('history:changed')
  }, delay)
}

function configureHistoryWatchers(accounts: AgentAccount[]): void {
  const roots = new Set(accounts.map(historyRoot).filter((root) => root && existsSync(root)))
  for (const [root, watcher] of historyWatchers) {
    if (roots.has(root)) continue
    watcher.close()
    historyWatchers.delete(root)
  }
  for (const root of roots) {
    if (historyWatchers.has(root)) continue
    try {
      const watcher = watch(root, { recursive: process.platform === 'win32' }, scheduleHistoryChanged)
      watcher.on('error', () => {
        watcher.close()
        historyWatchers.delete(root)
      })
      historyWatchers.set(root, watcher)
    } catch {
      // The renderer's low-frequency reconciliation covers unsupported watchers.
    }
  }
}

function closeHistoryWatchers(): void {
  clearTimeout(historyChangeTimer)
  historyChangeTimer = undefined
  for (const watcher of historyWatchers.values()) watcher.close()
  historyWatchers.clear()
}

function createWindow(): void {
  const developmentIcon = join(__dirname, '../../build/icon.png')
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    transparent: false,
    backgroundColor: '#121418',
    backgroundMaterial: 'none',
    thickFrame: true,
    ...(existsSync(developmentIcon) ? { icon: developmentIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized-changed', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized-changed', false))
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('profiles:list', () => getAgentHealth())
ipcMain.handle('accounts:detect', () => sessionHistory.detectAccounts())
ipcMain.handle('accounts:inspect', (_event, account: AgentAccount) => sessionHistory.inspectAccount(account))
ipcMain.handle('history:list', (_event, accounts: AgentAccount[]) => {
  configureHistoryWatchers(accounts)
  return sessionHistory.list(accounts)
})
ipcMain.handle('history:get', (_event, key: string, before?: number) => sessionHistory.get(key, before))
ipcMain.handle('search:query', (_event, query: string) => sessionHistory.searchConversations(query))
ipcMain.handle('search:state', () => sessionHistory.getSearchIndexState())
ipcMain.handle('search:rebuild', (_event, accounts: AgentAccount[]) => sessionHistory.rebuildSearchIndex(accounts))
ipcMain.handle('clipboard:read-terminal', async () => {
  const text = clipboard.readText()
  if (text) return { kind: 'text', value: text }

  const image = clipboard.readImage()
  if (!image.isEmpty()) {
    const directory = join(app.getPath('temp'), 'moacli', 'pasted-images')
    mkdirSync(directory, { recursive: true })
    const imagePath = join(directory, `${Date.now()}-${randomUUID()}.png`)
    writeFileSync(imagePath, image.toPNG())
    return { kind: 'image', value: imagePath, values: [imagePath] }
  }

  const imageFiles = await readWindowsClipboardImageFiles()
  return imageFiles.length
    ? { kind: 'image', value: imageFiles[0], values: imageFiles }
    : { kind: 'empty', value: '' }
})
ipcMain.on('clipboard:write-terminal', (_event, text: string) => {
  if (typeof text === 'string' && text) clipboard.writeText(text)
})
ipcMain.handle('directory:select', async (_event, defaultPath?: string) => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath,
    properties: ['openDirectory'],
  })
  return result.canceled ? null : result.filePaths[0] ?? null
})
ipcMain.handle('pty:start', async (_event, request: StartPtyRequest) => {
  try {
    await ptyHost.start(request)
  } catch (error) {
    notificationCenter?.handleStartFailure(request)
    throw error
  }
})
// Terminal write/resize/stop and output flow directly between the renderer
// and the PTY host utility process over this MessagePort.
ipcMain.on('pty-host:request-port', (event) => {
  if (event.sender === mainWindow?.webContents) ptyHost.connectRenderer(event.sender)
})
ipcMain.handle('notifications:snapshot', () => notifications().snapshot())
ipcMain.handle('notifications:update-settings', (_event, settings: Partial<NotificationSettings>) => notifications().updateSettings(settings))
ipcMain.handle('notifications:dismiss', (_event, id: string) => notifications().dismiss(id))
ipcMain.handle('notifications:clear', () => notifications().clear())
ipcMain.handle('notifications:acknowledge-session', (_event, sessionId: string) => notifications().acknowledgeSession(sessionId))
ipcMain.handle('notifications:mute-session', (_event, payload: { sessionId: string; muted: boolean }) => (
  notifications().setSessionMuted(payload.sessionId, payload.muted)
))
ipcMain.on('notifications:context', (_event, context: NotificationContext) => notifications().updateContext(context))
ipcMain.handle('delegation:snapshot', () => delegationSnapshot())
ipcMain.handle('delegation:approve', (_event, approval: DelegationApproval) => {
  delegationRegistryOrThrow().approve(approval.taskId, approval.account)
  return delegationSnapshot()
})
ipcMain.handle('delegation:reject', (_event, taskId: string) => {
  delegationRegistryOrThrow().reject(taskId)
  return delegationSnapshot()
})
ipcMain.handle('delegation:cancel', (_event, taskId: string) => {
  delegationRegistryOrThrow().cancel(taskId)
  return delegationSnapshot()
})
ipcMain.handle('delegation:retry', (_event, taskId: string) => {
  delegationRegistryOrThrow().retry(taskId)
  return delegationSnapshot()
})
ipcMain.handle('delegation:set-enabled', async (_event, enabled: boolean) => {
  if (!delegationServer) throw new Error('Delegation server is not available')
  await delegationServer.setEnabled(enabled === true)
  return delegationSnapshot()
})
ipcMain.handle('delegation:set-auto-approve', (_event, enabled: boolean) => {
  if (!delegationServer) throw new Error('Delegation server is not available')
  delegationServer.setAutoApprove(enabled === true)
  return delegationSnapshot()
})
ipcMain.handle('delegation:regenerate-token', () => {
  if (!delegationServer) throw new Error('Delegation server is not available')
  delegationServer.regenerateToken()
  return delegationSnapshot()
})
ipcMain.handle('updates:version', () => app.getVersion())
ipcMain.handle('updates:check', (_event, force = false) => checkForAppUpdate(force === true))
ipcMain.handle('updates:download', () => downloadAppUpdate())
ipcMain.on('window:minimize', (event) => {
  if (event.sender === mainWindow?.webContents) mainWindow.minimize()
})
ipcMain.on('window:toggle-maximize', (event) => {
  if (event.sender !== mainWindow?.webContents) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.on('window:close', (event) => {
  if (event.sender === mainWindow?.webContents) mainWindow.close()
})
ipcMain.handle('window:is-maximized', (event) => (
  event.sender === mainWindow?.webContents ? mainWindow.isMaximized() : false
))
ipcMain.on('shell:open-external', (event, url: string) => {
  if (event.sender !== mainWindow?.webContents) return
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return
  void shell.openExternal(url)
})

app.whenReady().then(async () => {
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => (
    String(permission) === 'local-fonts' && webContents === mainWindow?.webContents
  ))
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(String(permission) === 'local-fonts' && webContents === mainWindow?.webContents)
  })
  sessionHistory.configureSearch(join(app.getPath('userData'), 'conversation-search.sqlite'))
  notificationCenter = new NotificationCenter(join(app.getPath('userData'), 'notification-settings.json'), () => mainWindow)
  try {
    await attentionBridge.start(join(app.getPath('temp'), 'moacli', 'attention-hooks'))
  } catch (error) {
    console.warn('Needs-attention hook server could not start', error)
  }
  try {
    delegationRegistry = new DelegationTaskRegistry(
      join(app.getPath('userData'), 'delegation.sqlite'),
      emitDelegationChanged,
      (task, event) => {
        // Auto-approve starts the worker with the default account right away;
        // if that fails (e.g. concurrency cap), fall back to asking the user.
        // Retries always go through the approval modal — the point of retrying
        // is choosing another account.
        if (event === 'awaiting_approval' && delegationServer?.autoApprove && !task.retryOfId) {
          queueMicrotask(() => {
            try {
              delegationRegistry?.approve(task.id)
            } catch {
              notificationCenter?.handleDelegation(task, event)
            }
          })
          return
        }
        notificationCenter?.handleDelegation(task, event)
      },
      () => {
        if (delegationRegistry) sessionHistory.setWorkerSessions(delegationRegistry.workerSessions())
        scheduleHistoryChanged()
      },
    )
    // Worker transcripts belong to delegated tasks, not to the Recent list.
    sessionHistory.setWorkerSessions(delegationRegistry.workerSessions())
    delegationServer = new DelegationServer({
      userDataDirectory: app.getPath('userData'),
      appVersion: app.getVersion(),
      registry: delegationRegistry,
      onChanged: emitDelegationChanged,
    })
    await delegationServer.start()
  } catch (error) {
    delegationServer = null
    console.warn('Delegation MCP server could not start', error)
  }
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  quitting = true
  // Hold the quit until the PTY host has killed its ConPTY children, so CLI
  // agent processes do not outlive the app.
  event.preventDefault()
  closeHistoryWatchers()
  notificationCenter?.dispose()
  attentionBridge.dispose()
  delegationServer?.dispose()
  delegationRegistry?.close()
  void Promise.allSettled([ptyHost.shutdown(), sessionHistory.shutdown()]).then(() => app.quit())
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

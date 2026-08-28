import { join } from 'node:path'
import { existsSync, mkdirSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell } from 'electron'
import { getAgentHealth } from './agent-profiles'
import { checkForAppUpdate, downloadAppUpdate } from './app-updates'
import { AttentionBridge } from './attention-bridge'
import { DelegationServer } from './delegation-server'
import type { AgentAccount, NotificationContext, NotificationSettings, SearchIndexState, StartPtyRequest } from './contracts'
import { NotificationCenter } from './notification-center'
import { PtyHostClient } from './pty-host-client'
import { SessionHistoryService } from './session-history'

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
const sessionHistory = new SessionHistoryService()
let delegationServer: DelegationServer | null = null
const historyWatchers = new Map<string, FSWatcher>()
let historyChangeTimer: ReturnType<typeof setTimeout> | undefined
const CLIPBOARD_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

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
  clearTimeout(historyChangeTimer)
  historyChangeTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('history:changed')
  }, 700)
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
ipcMain.handle('history:get', (_event, key: string) => sessionHistory.get(key))
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
  sessionHistory.initializeSearch(
    join(app.getPath('userData'), 'conversation-search.sqlite'),
    (state: SearchIndexState) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('search:index-changed', state)
    },
  )
  notificationCenter = new NotificationCenter(join(app.getPath('userData'), 'notification-settings.json'), () => mainWindow)
  try {
    await attentionBridge.start(join(app.getPath('temp'), 'moacli', 'attention-hooks'))
  } catch (error) {
    console.warn('Needs-attention hook server could not start', error)
  }
  try {
    delegationServer = new DelegationServer(app.getPath('userData'), app.getVersion())
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
  sessionHistory.close()
  notificationCenter?.dispose()
  attentionBridge.dispose()
  delegationServer?.dispose()
  void ptyHost.shutdown().finally(() => app.quit())
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

import { join } from 'node:path'
import { existsSync, mkdirSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { app, BrowserWindow, clipboard, dialog, ipcMain } from 'electron'
import { getAgentHealth } from './agent-profiles'
import type { AgentAccount, StartPtyRequest } from './contracts'
import { PtyManager } from './pty-manager'
import { SessionHistoryService } from './session-history'

let mainWindow: BrowserWindow | null = null
app.setPath('userData', join(app.getPath('appData'), 'cli-agent-manager'))
const ptyManager = new PtyManager(() => mainWindow?.webContents ?? null)
const sessionHistory = new SessionHistoryService()
const historyWatchers = new Map<string, FSWatcher>()
let historyChangeTimer: ReturnType<typeof setTimeout> | undefined
const CLIPBOARD_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

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
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('profiles:list', () => getAgentHealth())
ipcMain.handle('accounts:detect', () => sessionHistory.detectAccounts())
ipcMain.handle('history:list', (_event, accounts: AgentAccount[]) => {
  configureHistoryWatchers(accounts)
  return sessionHistory.list(accounts)
})
ipcMain.handle('history:get', (_event, key: string) => sessionHistory.get(key))
ipcMain.handle('clipboard:read-terminal', async () => {
  const image = clipboard.readImage()
  if (!image.isEmpty()) {
    const directory = join(app.getPath('temp'), 'moacli', 'pasted-images')
    mkdirSync(directory, { recursive: true })
    const imagePath = join(directory, `${Date.now()}-${randomUUID()}.png`)
    writeFileSync(imagePath, image.toPNG())
    return { kind: 'image', value: imagePath, values: [imagePath] }
  }

  const text = clipboard.readText()
  if (text) return { kind: 'text', value: text }

  const imageFiles = await readWindowsClipboardImageFiles()
  return imageFiles.length
    ? { kind: 'image', value: imageFiles[0], values: imageFiles }
    : { kind: 'empty', value: '' }
})
ipcMain.handle('directory:select', async (_event, defaultPath?: string) => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath,
    properties: ['openDirectory'],
  })
  return result.canceled ? null : result.filePaths[0] ?? null
})
ipcMain.handle('pty:start', (_event, request: StartPtyRequest) => ptyManager.start(request))
ipcMain.on('pty:write', (_event, { id, data }: { id: string; data: string }) => ptyManager.write(id, data))
ipcMain.on('pty:resize', (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
  ptyManager.resize(id, cols, rows)
})
ipcMain.on('pty:stop', (_event, { id }: { id: string }) => ptyManager.stop(id))
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

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  closeHistoryWatchers()
  ptyManager.stopAll()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

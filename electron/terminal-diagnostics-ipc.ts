import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { TerminalDiagnosticStore } from './terminal-diagnostic-store'

export function attachTerminalDiagnosticsIpc(options: {
  directory: string; version: string; window: () => BrowserWindow | null;
  versions: () => Promise<Array<{ id: string; version?: string | null }>>;
}): () => Promise<void> {
  const store = new TerminalDiagnosticStore(options.directory)
  const record = (event: Electron.IpcMainEvent, payload: unknown): void => {
    if (event.sender !== options.window()?.webContents) return
    store.accept(payload)
  }
  ipcMain.on('terminal-diagnostics:record', record)
  ipcMain.handle('terminal-diagnostics:export', async (event) => {
    const window = options.window()
    if (!window || event.sender !== window.webContents) throw new Error('Invalid diagnostics caller')
    // Snapshot before opening a modal, so canceling the save still preserves the incident on disk.
    const snapshot = await store.snapshot()
    const result = await dialog.showSaveDialog(window, {
      title: 'Save terminal diagnostics', defaultPath: `MoaCLI-diagnostics-${Date.now()}.json`,
      filters: [{ name: 'Diagnostic log', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return false
    try {
      const versions = (await options.versions()).flatMap((profile) => {
        if (!['codex', 'claude', 'gemini', 'powershell', 'opencode'].includes(profile.id)) return []
        const version = profile.version?.match(/\b\d+\.\d+(?:\.\d+)?(?:[-+][a-zA-Z0-9.-]+)?\b/)?.[0]
        return [{ agent: profile.id, version: version ?? 'unknown' }]
      })
      await writeFile(result.filePath, JSON.stringify({ appVersion: options.version, platform: process.platform,
        electron: process.versions.electron, chrome: process.versions.chrome, xterm: '5.5.0',
        versions, diagnostics: snapshot }, null, 2), 'utf8')
      return true
    } catch { throw new Error('Could not save diagnostics. Choose another location and retry.') }
  })
  return async () => {
    ipcMain.removeListener('terminal-diagnostics:record', record)
    ipcMain.removeHandler('terminal-diagnostics:export')
    await store.close()
  }
}

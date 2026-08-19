import { contextBridge, ipcRenderer } from 'electron'
import type { CliAgentApi, PtyDataEvent, PtyExitEvent, StartPtyRequest } from './contracts'

const api: CliAgentApi = {
  getProfiles: () => ipcRenderer.invoke('profiles:list'),
  detectAccounts: () => ipcRenderer.invoke('accounts:detect'),
  inspectAccount: (account) => ipcRenderer.invoke('accounts:inspect', account),
  selectDirectory: (defaultPath?: string) => ipcRenderer.invoke('directory:select', defaultPath),
  listHistory: (accounts) => ipcRenderer.invoke('history:list', accounts),
  getConversation: (key: string) => ipcRenderer.invoke('history:get', key),
  readTerminalClipboard: () => ipcRenderer.invoke('clipboard:read-terminal'),
  startPty: (request: StartPtyRequest) => ipcRenderer.invoke('pty:start', request),
  writePty: (id, data) => ipcRenderer.send('pty:write', { id, data }),
  resizePty: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  stopPty: (id) => ipcRenderer.send('pty:stop', { id }),
  onPtyData: (id, callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: PtyDataEvent) => {
      if (payload.id === id) callback(payload.data)
    }
    ipcRenderer.on('pty:data', listener)
    return () => ipcRenderer.removeListener('pty:data', listener)
  },
  onPtyExit: (id, callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: PtyExitEvent) => {
      if (payload.id === id) callback(payload.exitCode)
    }
    ipcRenderer.on('pty:exit', listener)
    return () => ipcRenderer.removeListener('pty:exit', listener)
  },
  onHistoryChanged: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('history:changed', listener)
    return () => ipcRenderer.removeListener('history:changed', listener)
  },
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
}

contextBridge.exposeInMainWorld('cliAgent', api)

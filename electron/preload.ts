import { contextBridge, ipcRenderer } from 'electron'
import type { CliAgentApi, NotificationActivation, NotificationSnapshot, PtyAttentionEvent, PtyDataEvent, PtyExitEvent, SearchIndexState, StartPtyRequest } from './contracts'

type PtyDataCallback = (data: string) => void
type PtyExitCallback = (exitCode: number) => void
type PtyAttentionCallback = (reason: string) => void

const ptyDataCallbacks = new Map<string, Set<PtyDataCallback>>()
const ptyExitCallbacks = new Map<string, Set<PtyExitCallback>>()
const ptyAttentionCallbacks = new Map<string, Set<PtyAttentionCallback>>()

function subscribe<T>(listeners: Map<string, Set<T>>, id: string, callback: T): () => void {
  const callbacks = listeners.get(id) ?? new Set<T>()
  callbacks.add(callback)
  listeners.set(id, callbacks)
  return () => {
    callbacks.delete(callback)
    if (!callbacks.size) listeners.delete(id)
  }
}

ipcRenderer.on('pty:data', (_event, payload: PtyDataEvent) => {
  for (const callback of ptyDataCallbacks.get(payload.id) ?? []) callback(payload.data)
})
ipcRenderer.on('pty:exit', (_event, payload: PtyExitEvent) => {
  for (const callback of ptyExitCallbacks.get(payload.id) ?? []) callback(payload.exitCode)
})
ipcRenderer.on('pty:attention', (_event, payload: PtyAttentionEvent) => {
  for (const callback of ptyAttentionCallbacks.get(payload.id) ?? []) callback(payload.reason)
})

const api: CliAgentApi = {
  getProfiles: () => ipcRenderer.invoke('profiles:list'),
  detectAccounts: () => ipcRenderer.invoke('accounts:detect'),
  inspectAccount: (account) => ipcRenderer.invoke('accounts:inspect', account),
  selectDirectory: (defaultPath?: string) => ipcRenderer.invoke('directory:select', defaultPath),
  listHistory: (accounts) => ipcRenderer.invoke('history:list', accounts),
  getConversation: (key: string) => ipcRenderer.invoke('history:get', key),
  searchConversations: (query: string) => ipcRenderer.invoke('search:query', query),
  getSearchIndexState: () => ipcRenderer.invoke('search:state'),
  rebuildSearchIndex: (accounts) => ipcRenderer.invoke('search:rebuild', accounts),
  onSearchIndexChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: SearchIndexState): void => callback(state)
    ipcRenderer.on('search:index-changed', listener)
    return () => ipcRenderer.removeListener('search:index-changed', listener)
  },
  readTerminalClipboard: () => ipcRenderer.invoke('clipboard:read-terminal'),
  startPty: (request: StartPtyRequest) => ipcRenderer.invoke('pty:start', request),
  writePty: (id, data) => ipcRenderer.send('pty:write', { id, data }),
  resizePty: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  stopPty: (id) => ipcRenderer.send('pty:stop', { id }),
  onPtyData: (id, callback) => subscribe(ptyDataCallbacks, id, callback),
  onPtyExit: (id, callback) => subscribe(ptyExitCallbacks, id, callback),
  onPtyAttention: (id, callback) => subscribe(ptyAttentionCallbacks, id, callback),
  onHistoryChanged: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('history:changed', listener)
    return () => ipcRenderer.removeListener('history:changed', listener)
  },
  getNotificationSnapshot: () => ipcRenderer.invoke('notifications:snapshot'),
  updateNotificationSettings: (settings) => ipcRenderer.invoke('notifications:update-settings', settings),
  dismissNotification: (id) => ipcRenderer.invoke('notifications:dismiss', id),
  clearNotifications: () => ipcRenderer.invoke('notifications:clear'),
  acknowledgeSessionNotification: (sessionId) => ipcRenderer.invoke('notifications:acknowledge-session', sessionId),
  setSessionNotificationMuted: (sessionId, muted) => ipcRenderer.invoke('notifications:mute-session', { sessionId, muted }),
  updateNotificationContext: (context) => ipcRenderer.send('notifications:context', context),
  onNotificationsChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: NotificationSnapshot): void => callback(snapshot)
    ipcRenderer.on('notifications:changed', listener)
    return () => ipcRenderer.removeListener('notifications:changed', listener)
  },
  onNotificationActivated: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, activation: NotificationActivation): void => callback(activation)
    ipcRenderer.on('notifications:activate', listener)
    return () => ipcRenderer.removeListener('notifications:activate', listener)
  },
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
}

contextBridge.exposeInMainWorld('cliAgent', api)

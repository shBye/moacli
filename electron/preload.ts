import { contextBridge, ipcRenderer } from 'electron'
import type { CliAgentApi, DelegationSnapshot, NotificationActivation, NotificationSnapshot, PtyAttentionEvent, PtyExitEvent, SearchIndexState, StartPtyRequest } from './contracts'
import type { HostToRendererMessage, RendererToHostMessage } from './pty-host-protocol'

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

// Terminal I/O flows over a MessagePort wired straight to the PTY host
// utility process, so busy sessions never queue behind main-process work.
let ptyHostPort: MessagePort | null = null
const queuedPortMessages: RendererToHostMessage[] = []

function postToPtyHost(message: RendererToHostMessage): void {
  if (ptyHostPort) ptyHostPort.postMessage(message)
  else queuedPortMessages.push(message)
}

ipcRenderer.on('pty-host:port', (event) => {
  const port = event.ports[0]
  if (!port) return
  ptyHostPort?.close()
  ptyHostPort = port
  port.onmessage = (messageEvent: MessageEvent) => {
    const message = messageEvent.data as HostToRendererMessage
    if (message.type === 'data') {
      for (const callback of ptyDataCallbacks.get(message.id) ?? []) callback(message.data)
    } else if (message.type === 'exit') {
      for (const callback of ptyExitCallbacks.get(message.id) ?? []) callback(message.exitCode)
    }
  }
  for (const message of queuedPortMessages.splice(0)) port.postMessage(message)
})
ipcRenderer.send('pty-host:request-port')

// The main process still reports exits directly when the PTY host itself dies.
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
  getConversation: (key: string, before?: number) => ipcRenderer.invoke('history:get', key, before),
  searchConversations: (query: string) => ipcRenderer.invoke('search:query', query),
  getSearchIndexState: () => ipcRenderer.invoke('search:state'),
  rebuildSearchIndex: (accounts) => ipcRenderer.invoke('search:rebuild', accounts),
  onSearchIndexChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: SearchIndexState): void => callback(state)
    ipcRenderer.on('search:index-changed', listener)
    return () => ipcRenderer.removeListener('search:index-changed', listener)
  },
  readTerminalClipboard: () => ipcRenderer.invoke('clipboard:read-terminal'),
  writeTerminalClipboard: (text: string) => ipcRenderer.send('clipboard:write-terminal', text),
  startPty: (request: StartPtyRequest) => ipcRenderer.invoke('pty:start', request),
  writePty: (id, data) => postToPtyHost({ type: 'write', id, data }),
  resizePty: (id, cols, rows) => postToPtyHost({ type: 'resize', id, cols, rows }),
  stopPty: (id) => postToPtyHost({ type: 'stop', id }),
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
  getDelegationSnapshot: () => ipcRenderer.invoke('delegation:snapshot'),
  approveDelegation: (approval) => ipcRenderer.invoke('delegation:approve', approval),
  rejectDelegation: (taskId) => ipcRenderer.invoke('delegation:reject', taskId),
  cancelDelegation: (taskId) => ipcRenderer.invoke('delegation:cancel', taskId),
  setDelegationEnabled: (enabled) => ipcRenderer.invoke('delegation:set-enabled', enabled),
  regenerateDelegationToken: () => ipcRenderer.invoke('delegation:regenerate-token'),
  onDelegationChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: DelegationSnapshot): void => callback(snapshot)
    ipcRenderer.on('delegation:changed', listener)
    return () => ipcRenderer.removeListener('delegation:changed', listener)
  },
  getAppVersion: () => ipcRenderer.invoke('updates:version'),
  checkForAppUpdate: (force?: boolean) => ipcRenderer.invoke('updates:check', force),
  downloadAppUpdate: () => ipcRenderer.invoke('updates:download'),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximizedChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean): void => callback(maximized)
    ipcRenderer.on('window:maximized-changed', listener)
    return () => ipcRenderer.removeListener('window:maximized-changed', listener)
  },
  openExternal: (url: string) => ipcRenderer.send('shell:open-external', url),
}

contextBridge.exposeInMainWorld('cliAgent', api)

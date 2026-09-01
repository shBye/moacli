import { utilityProcess, type UtilityProcess } from 'electron'
import type {
  AgentAccount,
  ConversationHistory,
  ConversationSearchResponse,
  HistorySession,
  SearchIndexState,
} from './contracts'
import type { HistoryHostMethodName, HistoryHostToMainMessage, MainToHistoryHostMessage } from './history-host-protocol'

const SHUTDOWN_GRACE_MS = 700

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

// Main-process boundary to the history host utility process. Every lookup is
// an async RPC call, so however slow the underlying file or sqlite work is,
// the main process stays responsive; a late answer just resolves late and the
// renderer swaps its state in whenever the data arrives.
export class HistoryHostClient {
  private host: UtilityProcess | null = null
  private hostReady: Promise<void> | null = null
  private nextRequestId = 1
  private readonly pending = new Map<number, PendingCall>()
  private searchDatabasePath = ''
  private workerSessionIds: string[] = []
  private disposed = false

  constructor(
    private readonly modulePath: string,
    private readonly onSearchStateChanged: (state: SearchIndexState) => void,
  ) {}

  // Stored and re-applied on every (re)fork, so a crashed host comes back with
  // the same search index and session filter.
  configureSearch(databasePath: string): void {
    this.searchDatabasePath = databasePath
    this.host?.postMessage({ type: 'configure', searchDatabasePath: databasePath } satisfies MainToHistoryHostMessage)
    void this.ensureHost().catch(() => {})
  }

  setWorkerSessions(ids: string[]): void {
    this.workerSessionIds = ids
    this.host?.postMessage({ type: 'worker-sessions', ids } satisfies MainToHistoryHostMessage)
  }

  detectAccounts(): Promise<AgentAccount[]> {
    return this.call('detectAccounts', [])
  }

  inspectAccount(account: AgentAccount): Promise<AgentAccount | null> {
    return this.call('inspectAccount', [account])
  }

  list(accounts: AgentAccount[]): Promise<HistorySession[]> {
    return this.call('list', [accounts])
  }

  get(key: string, before?: number): Promise<ConversationHistory> {
    return this.call('get', [key, before])
  }

  searchConversations(query: string): Promise<ConversationSearchResponse> {
    return this.call('searchConversations', [query])
  }

  getSearchIndexState(): Promise<SearchIndexState> {
    return this.call('getSearchIndexState', [])
  }

  rebuildSearchIndex(accounts: AgentAccount[]): Promise<SearchIndexState> {
    return this.call('rebuildSearchIndex', [accounts])
  }

  async shutdown(): Promise<void> {
    this.disposed = true
    const host = this.host
    this.host = null
    this.hostReady = null
    for (const call of this.pending.values()) call.reject(new Error('History host is shutting down'))
    this.pending.clear()
    if (!host) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        host.kill()
        resolve()
      }, SHUTDOWN_GRACE_MS)
      host.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      host.postMessage({ type: 'shutdown' } satisfies MainToHistoryHostMessage)
    })
  }

  private call<T>(method: HistoryHostMethodName, args: unknown[]): Promise<T> {
    return this.ensureHost().then(() => new Promise<T>((resolve, reject) => {
      const host = this.host
      if (!host) {
        reject(new Error('History host is not running'))
        return
      }
      const requestId = this.nextRequestId
      this.nextRequestId += 1
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject })
      host.postMessage({ type: 'call', requestId, method, args } satisfies MainToHistoryHostMessage)
    }))
  }

  private ensureHost(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('History host is shut down'))
    if (this.host && this.hostReady) return this.hostReady
    const host = utilityProcess.fork(this.modulePath, [], { serviceName: 'moacli-history-host' })
    this.host = host
    const ready = new Promise<void>((resolve, reject) => {
      host.on('message', (message: HistoryHostToMainMessage) => {
        if (message.type === 'ready') {
          if (this.searchDatabasePath) {
            host.postMessage({ type: 'configure', searchDatabasePath: this.searchDatabasePath } satisfies MainToHistoryHostMessage)
          }
          if (this.workerSessionIds.length) {
            host.postMessage({ type: 'worker-sessions', ids: this.workerSessionIds } satisfies MainToHistoryHostMessage)
          }
          resolve()
        }
        this.handleHostMessage(message)
      })
      host.once('exit', () => reject(new Error('History host exited during startup')))
    })
    ready.catch(() => {
      // Rejection reaches whoever awaits ensureHost; this handler only keeps
      // an unused stored promise from raising an unhandled rejection.
    })
    this.hostReady = ready
    host.on('exit', () => this.handleHostExit(host))
    return ready
  }

  private handleHostMessage(message: HistoryHostToMainMessage): void {
    if (message.type === 'result') {
      const call = this.pending.get(message.requestId)
      this.pending.delete(message.requestId)
      if (!call) return
      if (message.error !== undefined) call.reject(new Error(message.error))
      else call.resolve(message.value)
    } else if (message.type === 'search-state') {
      this.onSearchStateChanged(message.state)
    }
  }

  private handleHostExit(host: UtilityProcess): void {
    if (this.host !== host) return
    this.host = null
    this.hostReady = null
    for (const call of this.pending.values()) call.reject(new Error('History host exited unexpectedly'))
    this.pending.clear()
    // The next call re-forks lazily; the renderer's watcher- and focus-driven
    // refreshes retry on their own.
  }
}

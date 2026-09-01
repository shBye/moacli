import type { AgentAccount } from './contracts'
import type { HistoryHostToMainMessage, MainToHistoryHostMessage } from './history-host-protocol'
import { SessionHistoryService } from './session-history'

// Entry point of the history host utility process. Session lists, transcript
// pages, and the search index all do synchronous file and sqlite work; running
// them here keeps the main process message loop free, so a slow disk (or an
// antivirus scan of the transcript files) can no longer freeze the window.

const parentPort = process.parentPort
const service = new SessionHistoryService()
// Transcript ids written by delegated workers; those sessions stay out of the
// Recent list and the search index.
const workerSessionIds = new Set<string>()
service.setSessionFilter((session) => !workerSessionIds.has(session.resumeId))

function send(message: HistoryHostToMainMessage): void {
  parentPort.postMessage(message)
}

function dispatch(method: string, args: unknown[]): Promise<unknown> {
  switch (method) {
    case 'detectAccounts': return service.detectAccounts()
    case 'inspectAccount': return service.inspectAccount(args[0] as AgentAccount)
    case 'list': return service.list(args[0] as AgentAccount[])
    case 'get': return service.get(args[0] as string, args[1] as number | undefined)
    case 'searchConversations': return Promise.resolve(service.searchConversations(args[0] as string))
    case 'getSearchIndexState': return Promise.resolve(service.getSearchIndexState())
    case 'rebuildSearchIndex': return service.rebuildSearchIndex(args[0] as AgentAccount[])
    default: return Promise.reject(new Error(`Unknown history host method: ${method}`))
  }
}

parentPort.on('message', (event) => {
  const message = event.data as MainToHistoryHostMessage
  if (message.type === 'configure') {
    service.initializeSearch(message.searchDatabasePath, (state) => send({ type: 'search-state', state }))
  } else if (message.type === 'worker-sessions') {
    workerSessionIds.clear()
    for (const id of message.ids) workerSessionIds.add(id)
  } else if (message.type === 'call') {
    dispatch(message.method, message.args).then(
      (value) => send({ type: 'result', requestId: message.requestId, value }),
      (error: unknown) => send({
        type: 'result',
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  } else if (message.type === 'shutdown') {
    service.close()
    process.exit(0)
  }
})

send({ type: 'ready' })

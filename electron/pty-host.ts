import type { MessagePortMain } from 'electron'
import { PtyManager } from './pty-manager'
import type { HostToMainMessage, HostToRendererMessage, MainToHostMessage, RendererToHostMessage } from './pty-host-protocol'

// Entry point of the PTY host utility process. Terminal output goes straight
// to the renderer over a MessagePort; only lifecycle events (spawn results,
// exits, attention signals) go to the main process.

const parentPort = process.parentPort
let rendererPort: MessagePortMain | null = null

function sendToMain(message: HostToMainMessage): void {
  parentPort.postMessage(message)
}

function sendToRenderer(message: HostToRendererMessage): void {
  rendererPort?.postMessage(message)
}

const manager = new PtyManager({
  data: (id, data) => sendToRenderer({ type: 'data', id, data }),
  exit: (id, exitCode, intentional) => {
    sendToRenderer({ type: 'exit', id, exitCode })
    sendToMain({ type: 'exit', id, exitCode, intentional })
  },
  attention: (id, reason) => sendToMain({ type: 'attention', id, reason }),
})

function handleRendererMessage(message: RendererToHostMessage): void {
  if (message.type === 'write') manager.write(message.id, message.data)
  else if (message.type === 'resize') manager.resize(message.id, message.cols, message.rows)
  else if (message.type === 'stop') manager.stop(message.id)
}

function attachRendererPort(port: MessagePortMain | undefined): void {
  rendererPort?.close()
  rendererPort = port ?? null
  if (!rendererPort) return
  rendererPort.on('message', (portEvent) => handleRendererMessage(portEvent.data as RendererToHostMessage))
  rendererPort.start()
}

parentPort.on('message', (event) => {
  const message = event.data as MainToHostMessage
  if (message.type === 'renderer-port') {
    attachRendererPort(event.ports[0])
  } else if (message.type === 'spawn') {
    try {
      manager.spawn(message.spec)
      sendToMain({ type: 'spawn-result', requestId: message.requestId })
    } catch (error) {
      sendToMain({
        type: 'spawn-result',
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  } else if (message.type === 'stop') {
    manager.stop(message.id)
  } else if (message.type === 'shutdown') {
    manager.stopAll()
    process.exit(0)
  }
})

sendToMain({ type: 'ready' })

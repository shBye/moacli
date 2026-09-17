export interface OutputClock {
  now: () => number
  schedule: (callback: () => void) => ReturnType<typeof setTimeout>
  cancel: (timer: ReturnType<typeof setTimeout>) => void
  dispose?: () => void
}

// MessageChannel yields between parser slices without the nested setTimeout
// minimum delay. Keep one channel while terminals exist and close it on cleanup.
export function createTerminalOutputClock(): OutputClock {
  let channel: MessageChannel | undefined
  let nextId = 0
  const callbacks = new Map<ReturnType<typeof setTimeout>, () => void>()
  return {
    now: () => performance.now(),
    schedule: callback => {
      if (!channel) {
        channel = new MessageChannel()
        channel.port1.onmessage = event => {
          const id = event.data as ReturnType<typeof setTimeout>
          const run = callbacks.get(id)
          callbacks.delete(id)
          run?.()
        }
      }
      const id = ++nextId as unknown as ReturnType<typeof setTimeout>
      callbacks.set(id, callback)
      channel.port2.postMessage(id)
      return id
    },
    cancel: id => { callbacks.delete(id) },
    dispose: () => {
      callbacks.clear()
      channel?.port1.close(); channel?.port2.close(); channel = undefined
    },
  }
}

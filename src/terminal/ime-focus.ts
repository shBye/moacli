interface PendingTerminalFocus {
  terminalId: string
  focus: () => void
  timer: number
}

let composingTerminalId = ''
let pendingFocus: PendingTerminalFocus | null = null

function clearPendingFocus(): void {
  if (!pendingFocus) return
  window.clearTimeout(pendingFocus.timer)
  pendingFocus = null
}

function flushPendingFocus(): void {
  const pending = pendingFocus
  if (!pending) return
  clearPendingFocus()
  pending.focus()
}

export function beginTerminalComposition(terminalId: string): void {
  composingTerminalId = terminalId
}

export function endTerminalComposition(terminalId: string): void {
  if (composingTerminalId !== terminalId) return
  composingTerminalId = ''
  if (pendingFocus) queueMicrotask(flushPendingFocus)
}

export function requestTerminalFocus(terminalId: string, focus: () => void): () => void {
  clearPendingFocus()
  if (!composingTerminalId || composingTerminalId === terminalId) {
    focus()
    return () => undefined
  }

  const pending: PendingTerminalFocus = {
    terminalId,
    focus,
    timer: window.setTimeout(() => {
      if (pendingFocus !== pending) return
      composingTerminalId = ''
      flushPendingFocus()
    }, 180),
  }
  pendingFocus = pending
  return () => {
    if (pendingFocus === pending) clearPendingFocus()
  }
}

export function cancelTerminalFocus(terminalId: string): void {
  if (pendingFocus?.terminalId === terminalId) clearPendingFocus()
  if (composingTerminalId === terminalId) composingTerminalId = ''
}

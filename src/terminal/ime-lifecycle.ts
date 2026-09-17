export interface ImeLifecyclePort {
  begin: () => void
  end: () => void
  refresh: () => void
  activity?: () => void
}

export function attachImeLifecycle(
  textarea: HTMLTextAreaElement | undefined,
  port: ImeLifecyclePort,
): () => void {
  if (!textarea) return () => undefined

  let composing = false
  let refreshFrame: number | undefined

  const start = (): void => {
    composing = true
    port.activity?.()
    port.begin()
  }

  const activity = (): void => { port.activity?.() }
  const end = (): void => {
    if (!composing) return
    composing = false
    port.end()
    if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = undefined
      port.refresh()
    })
  }

  textarea.addEventListener('compositionstart', start)
  textarea.addEventListener('compositionend', end)
  textarea.addEventListener('blur', end)
  textarea.addEventListener('keydown', activity)
  textarea.addEventListener('compositionupdate', activity)

  return () => {
    if (composing) port.end()
    if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
    textarea.removeEventListener('compositionstart', start)
    textarea.removeEventListener('compositionend', end)
    textarea.removeEventListener('blur', end)
    textarea.removeEventListener('keydown', activity)
    textarea.removeEventListener('compositionupdate', activity)
  }
}

export interface ImeLifecyclePort {
  begin: () => void
  end: () => void
  refresh: () => void
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
    port.begin()
  }
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

  return () => {
    if (composing) port.end()
    if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
    textarea.removeEventListener('compositionstart', start)
    textarea.removeEventListener('compositionend', end)
    textarea.removeEventListener('blur', end)
  }
}

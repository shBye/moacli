import type { TerminalClipboardContent } from '../../electron/contracts'
import { isTerminalPasteShortcut, toTerminalPasteText } from './terminal-clipboard'

export interface TerminalPastePort {
  paste: (text: string) => void
  readClipboard: () => Promise<TerminalClipboardContent>
}

export function attachTerminalPaste(
  textarea: HTMLTextAreaElement | undefined,
  port: TerminalPastePort,
): () => void {
  if (!textarea) return () => undefined

  let disposed = false
  const pasteClipboard = (): void => {
    void port.readClipboard().then((content) => {
      if (disposed) return
      const text = toTerminalPasteText(content)
      if (text !== null) port.paste(text)
    })
  }
  const onPasteShortcut = (event: KeyboardEvent): void => {
    if (!isTerminalPasteShortcut(event)) return

    // Codex uses the raw Ctrl+V byte as its image-paste shortcut. Consume the
    // browser shortcut before xterm can forward it to the CLI.
    event.preventDefault()
    event.stopImmediatePropagation()
    pasteClipboard()
  }
  const onPaste = (event: ClipboardEvent): void => {
    event.preventDefault()
    event.stopImmediatePropagation()
    const text = event.clipboardData?.getData('text/plain')
    if (text) {
      port.paste(text)
      return
    }
    pasteClipboard()
  }

  textarea.addEventListener('keydown', onPasteShortcut, true)
  textarea.addEventListener('paste', onPaste, true)

  return () => {
    disposed = true
    textarea.removeEventListener('keydown', onPasteShortcut, true)
    textarea.removeEventListener('paste', onPaste, true)
  }
}

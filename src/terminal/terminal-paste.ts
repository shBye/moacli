import type { TerminalClipboardContent } from '../../electron/contracts'
import { isTerminalPasteShortcut, toTerminalPasteText } from './terminal-clipboard'

export interface TerminalPastePort {
  paste: (text: string) => void
  readClipboard: () => Promise<TerminalClipboardContent>
}

export interface TerminalPasteControls {
  dispose: () => void
  pasteFromClipboard: () => void
}

// The Ctrl+V shortcut itself is intercepted in the terminal's custom key
// handler (which runs before xterm's), so the raw 0x16 byte never reaches the
// CLI — Codex treats it as its own image-paste shortcut. This attachment only
// covers non-keyboard paste routes such as the context menu.
export function attachTerminalPaste(
  textarea: HTMLTextAreaElement | undefined,
  port: TerminalPastePort,
): TerminalPasteControls {
  let disposed = false
  const pasteFromClipboard = (): void => {
    void port.readClipboard().then((content) => {
      if (disposed) return
      const text = toTerminalPasteText(content)
      if (text !== null) port.paste(text)
    })
  }
  if (!textarea) return { dispose: () => undefined, pasteFromClipboard }

  const onPaste = (event: ClipboardEvent): void => {
    event.preventDefault()
    event.stopImmediatePropagation()
    const text = event.clipboardData?.getData('text/plain')
    if (text) {
      port.paste(text)
      return
    }
    pasteFromClipboard()
  }

  textarea.addEventListener('paste', onPaste, true)

  return {
    dispose: () => {
      disposed = true
      textarea.removeEventListener('paste', onPaste, true)
    },
    pasteFromClipboard,
  }
}

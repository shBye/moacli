import type { Terminal } from '@xterm/xterm'
import { beginTerminalComposition, endTerminalComposition } from './ime-focus'

export function attachImeOverlay(terminal: Terminal, terminalId: string): () => void {
  const textarea = terminal.textarea
  const screen = terminal.element?.querySelector<HTMLElement>('.xterm-screen')
  if (!textarea || !screen) return () => undefined

  const overlay = document.createElement('div')
  overlay.className = 'ime-composition'
  screen.appendChild(overlay)

  let composing = false

  const position = (): void => {
    if (!composing) return
    const bounds = screen.getBoundingClientRect()
    const cellWidth = bounds.width / terminal.cols
    const cellHeight = bounds.height / terminal.rows
    const buffer = terminal.buffer.active
    const textCells = Math.max(2, Array.from(overlay.textContent ?? '').length * 2)
    let left = buffer.cursorX * cellWidth
    let top = buffer.cursorY * cellHeight

    if (left + textCells * cellWidth > bounds.width) {
      left = 0
      top = Math.min(top + cellHeight, bounds.height - cellHeight)
    }

    overlay.style.left = `${left}px`
    overlay.style.top = `${top}px`
    overlay.style.minWidth = `${textCells * cellWidth}px`
    overlay.style.height = `${cellHeight}px`
    overlay.style.fontSize = `${Math.max(11, cellHeight * 0.78)}px`
    overlay.style.lineHeight = `${cellHeight}px`
  }

  const start = (): void => {
    composing = true
    beginTerminalComposition(terminalId)
    overlay.textContent = ''
    overlay.dataset.visible = 'true'
    position()
  }
  const update = (event: CompositionEvent): void => {
    overlay.textContent = event.data ?? ''
    position()
  }
  const end = (): void => {
    composing = false
    endTerminalComposition(terminalId)
    overlay.textContent = ''
    delete overlay.dataset.visible
  }

  textarea.addEventListener('compositionstart', start)
  textarea.addEventListener('compositionupdate', update)
  textarea.addEventListener('compositionend', end)
  const renderDisposable = terminal.onRender(position)

  return () => {
    if (composing) endTerminalComposition(terminalId)
    textarea.removeEventListener('compositionstart', start)
    textarea.removeEventListener('compositionupdate', update)
    textarea.removeEventListener('compositionend', end)
    renderDisposable.dispose()
    overlay.remove()
  }
}

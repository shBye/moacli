import type { Terminal } from '@xterm/xterm'
import { diagnosticAgent, isUpwardJump, type DiagnosticPosition, type DiagnosticReason, type TerminalDiagnosticEvent } from '../shared/terminal-diagnostics'
import { registerTerminalDiagnostics } from './terminal-diagnostics-registry'

export function attachTerminalDiagnostics(
  terminal: Terminal,
  container: HTMLElement,
  options: { id: string; agent: string; active: () => boolean; send: (events: TerminalDiagnosticEvent[]) => void },
) {
  const started = performance.now()
  const agent = diagnosticAgent(options.agent)
  const viewport = container.querySelector<HTMLElement>('.xterm-viewport')
  let previous: DiagnosticPosition | undefined
  let sequence = 0
  let outputChars = 0
  let outputBatches = 0
  let dropped = 0
  let dirty = true
  let lastOutput = 0
  let settled = true
  let disposed = false
  let queue: TerminalDiagnosticEvent[] = []
  let burstAt = 0
  let burstCount = 0
  let attentionBurstCount = 0
  let layout = { scrollTop: -1, scrollHeight: -1, clientHeight: -1 }
  const sampleLayout = (): void => {
    if (!options.active() || !viewport) return
    layout = { scrollTop: viewport.scrollTop, scrollHeight: viewport.scrollHeight, clientHeight: viewport.clientHeight }
  }
  const position = (): DiagnosticPosition => {
    const buffer = terminal.buffer.active
    return {
      base: buffer.baseY, viewport: buffer.viewportY, cursor: buffer.cursorY,
      rows: terminal.rows, cols: terminal.cols, buffer: buffer.type,
      active: options.active(), focused: document.activeElement === terminal.textarea,
      ...layout,
    }
  }
  const flush = (): void => {
    if (!queue.length) return
    const events = queue
    queue = []
    try { options.send(events) } catch { dropped += events.length }
  }
  const record = (reason: DiagnosticReason, value?: number): void => {
    if (disposed) return
    const now = performance.now()
    if (now - burstAt >= 500) { burstAt = now; burstCount = 0; attentionBurstCount = 0 }
    // Keep diagnostic work bounded even for rapidly scrolling output.
    const attentionSlot = reason === 'attention' && attentionBurstCount++ < 10
    if (burstCount >= 40 && !attentionSlot && reason !== 'user-mark' && reason !== 'disposed') { dropped++; dirty = true; return }
    burstCount++
    const current = position()
    const jump = isUpwardJump(previous, current)
    queue.push({ terminal: options.id, agent, reason, at: Date.now(), elapsed: now - started,
      sequence: ++sequence, position: current, previous: jump ? previous : undefined,
      jump, outputChars, outputBatches, dropped, value })
    previous = current
    if (queue.length >= 80 || jump || reason === 'user-mark') flush()
  }
  const disposables = [
    terminal.onScroll(() => record('scroll')),
    terminal.buffer.onBufferChange(() => record('buffer-change')),
    terminal.onWriteParsed(() => { dirty = true }),
    terminal.parser.registerCsiHandler({ final: 'J' }, (params) => {
      const mode = params[0]
      record('erase-display', typeof mode === 'number' && mode >= 0 && mode <= 3 ? mode : -1)
      return false
    }),
    terminal.parser.registerEscHandler({ final: 'c' }, () => { record('reset'); return false }),
    ...(['h', 'l'] as const).map((final) => terminal.parser.registerCsiHandler({ prefix: '?', final }, (params) => {
      if (params.some((mode) => mode === 47 || mode === 1047 || mode === 1049)) record(final === 'h' ? 'alternate-on' : 'alternate-off')
      if (params.includes(2026)) record(final === 'h' ? 'sync-on' : 'sync-off')
      return false
    })),
  ]
  const onWheel = (event: WheelEvent) => { if (!event.ctrlKey) record(event.deltaY < 0 ? 'wheel-up' : 'wheel-down') }
  const onPointer = () => record('pointer')
  const onKey = (event: KeyboardEvent) => record(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key) ? 'navigation' : 'input')
  const onDomScroll = () => record('dom-scroll')
  container.addEventListener('wheel', onWheel, { passive: true })
  container.addEventListener('pointerdown', onPointer, true)
  container.addEventListener('keydown', onKey, true)
  viewport?.addEventListener('scroll', onDomScroll, { passive: true })
  const timer = setInterval(() => {
    // Geometry reads can force layout. Keep them out of keydown and ANSI parser
    // callbacks; only sample the visible viewport at the diagnostic cadence.
    sampleLayout()
    if (dirty) {
      dirty = false
      const bufferChanged = previous && previous.buffer !== terminal.buffer.active.type
      record(bufferChanged ? 'buffer-change' : 'sample')
    }
    if (!settled && performance.now() - lastOutput >= 1000) {
      settled = true
      record('output-settled') // Quiet output is not a semantic response-completed event.
    }
    flush()
  }, 250)
  const unregister = registerTerminalDiagnostics(() => { record('user-mark'); flush() })
  record('attached')
  return {
    record,
    output: (length: number) => { outputChars += length; outputBatches++; lastOutput = performance.now(); settled = false; dirty = true },
    dispose: () => {
      record('disposed'); flush(); disposed = true
      clearInterval(timer)
      unregister()
      for (const disposable of disposables) disposable.dispose()
      container.removeEventListener('wheel', onWheel)
      container.removeEventListener('pointerdown', onPointer, true)
      container.removeEventListener('keydown', onKey, true)
      viewport?.removeEventListener('scroll', onDomScroll)
    },
  }
}

import type { Terminal } from '@xterm/xterm'
import type { DiagnosticReason } from '../shared/terminal-diagnostics'
import { shouldFollowCodexRedraw } from './codex-redraw-policy'

// Owns a short bottom-follow window for Codex's erase-scrollback + transcript redraw.
// Escape sequences remain untouched; user navigation always wins.
export function attachCodexRedrawFollow(terminal: Terminal, container: HTMLElement, options: {
  active: () => boolean; record: (reason: DiagnosticReason) => void;
}, clock = {
  now: () => performance.now(),
  frame: (callback: () => void) => requestAnimationFrame(callback),
  cancelFrame: (id: number) => cancelAnimationFrame(id),
  timeout: (callback: () => void, ms: number) => window.setTimeout(callback, ms),
  clearTimeout: (id: number) => window.clearTimeout(id),
}) {
  let following = false
  let synchronized = false
  let deadline = 0
  let frame: number | undefined
  let settleTimer: number | undefined
  let limitTimer: number | undefined
  const stop = () => {
    following = false
    if (frame !== undefined) clock.cancelFrame(frame)
    if (settleTimer !== undefined) clock.clearTimeout(settleTimer)
    if (limitTimer !== undefined) clock.clearTimeout(limitTimer)
    frame = settleTimer = limitTimer = undefined
  }
  const follow = () => {
    if (!following) return
    if (!options.active() || terminal.buffer.active.type !== 'normal' || clock.now() > deadline) { stop(); return }
    options.record('redraw-follow')
    terminal.scrollToBottom()
  }
  const onUserNavigation = () => {
    if (following) options.record('redraw-cancel')
    stop()
  }
  const onKey = (event: KeyboardEvent) => {
    if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) onUserNavigation()
  }
  const disposables = [
    terminal.parser.registerCsiHandler({ final: 'J' }, params => {
      if (params.length === 1 && params[0] === 3) {
        const buffer = terminal.buffer.active
        const eligible = shouldFollowCodexRedraw({ active: options.active(), buffer: buffer.type, base: buffer.baseY, viewport: buffer.viewportY })
        stop()
        if (eligible) {
          following = true
          deadline = clock.now() + 2000
          options.record('redraw-arm')
          limitTimer = clock.timeout(stop, 2000)
        }
      }
      return false
    }),
    ...(['h', 'l'] as const).map(final => terminal.parser.registerCsiHandler({ prefix: '?', final }, params => {
      if (params.includes(2026)) synchronized = final === 'h'
      return false
    })),
    terminal.onWriteParsed(() => {
      if (!following) return
      follow()
      if (!following) return
      if (frame !== undefined) clock.cancelFrame(frame)
      frame = clock.frame(() => { frame = undefined; follow() })
      if (settleTimer !== undefined) clock.clearTimeout(settleTimer)
      if (!synchronized) settleTimer = clock.timeout(() => { follow(); stop() }, 120)
    }),
  ]
  container.addEventListener('wheel', onUserNavigation, { passive: true })
  container.addEventListener('pointerdown', onUserNavigation, true)
  container.addEventListener('keydown', onKey, true)
  container.addEventListener('touchstart', onUserNavigation, { passive: true })
  return () => {
    stop()
    for (const disposable of disposables) disposable.dispose()
    container.removeEventListener('wheel', onUserNavigation)
    container.removeEventListener('pointerdown', onUserNavigation, true)
    container.removeEventListener('keydown', onKey, true)
    container.removeEventListener('touchstart', onUserNavigation)
  }
}

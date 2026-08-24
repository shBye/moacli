import { memo, useEffect, useRef } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { attachImeOverlay } from './ime-overlay'
import { cancelTerminalFocus, requestTerminalFocus } from './ime-focus'
import type { AgentAccount } from '../../electron/contracts'

interface TerminalPaneProps {
  active: boolean
  sessionId: string
  agentId: string
  cwd: string
  title: string
  account?: AgentAccount
  purpose?: 'session' | 'login'
  resumeId?: string
  revealLatestAt: number
  fontFamily: string
  fontSize: number
  background: string
  foreground: string
  cursorColor: string
  activityStatusEnabled: boolean
  onActivity: () => void
  onStateChange: (state: 'starting' | 'running' | 'processing' | 'needs_attention' | 'stopped', detail?: string) => void
}

const TERMINAL_SCROLLBACK = 10000
const MIN_STARTING_INDICATOR_MS = 650
const CODEX_MOUSE_TRACKING_MODES = new Set([9, 1000, 1002, 1003, 1005, 1006, 1015, 1016])

function TerminalPaneComponent({ active, sessionId, agentId, cwd, title, account, purpose = 'session', resumeId, revealLatestAt, fontFamily, fontSize, background, foreground, cursorColor, activityStatusEnabled, onActivity, onStateChange }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const ptyIdRef = useRef('')
  const ptyReadyRef = useRef(false)
  const activeRef = useRef(active)
  const activityRef = useRef(onActivity)
  const stateChangeRef = useRef(onStateChange)
  const activityStatusEnabledRef = useRef(activityStatusEnabled)
  activeRef.current = active
  activityRef.current = onActivity
  stateChangeRef.current = onStateChange
  activityStatusEnabledRef.current = activityStatusEnabled

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const id = crypto.randomUUID()
    const terminal = new Terminal({
      cursorBlink: activeRef.current,
      cursorStyle: 'bar',
      fontFamily,
      fontSize,
      lineHeight: 1.3,
      scrollback: TERMINAL_SCROLLBACK,
      allowTransparency: false,
      allowProposedApi: false,
      theme: {
        background,
        foreground,
        cursor: cursorColor,
        cursorAccent: '#111315',
        selectionBackground: '#36515E',
        black: '#111315',
        red: '#F87171',
        green: '#6EE7B7',
        yellow: '#FBBF24',
        blue: '#7DD3FC',
        magenta: '#C4B5FD',
        cyan: '#67E8F9',
        white: '#E7E9EA',
      },
    })
    terminalRef.current = terminal
    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    ptyIdRef.current = id
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    container.dataset.renderer = 'default'
    let webglAddon: WebglAddon | undefined
    let webglContextLossDisposable: { dispose: () => void } | undefined
    try {
      webglAddon = new WebglAddon()
      webglContextLossDisposable = webglAddon.onContextLoss(() => {
        webglContextLossDisposable?.dispose()
        webglContextLossDisposable = undefined
        webglAddon?.dispose()
        webglAddon = undefined
        container.dataset.renderer = 'fallback'
      })
      terminal.loadAddon(webglAddon)
      container.dataset.renderer = 'webgl'
    } catch {
      webglContextLossDisposable?.dispose()
      webglAddon?.dispose()
      webglAddon = undefined
      container.dataset.renderer = 'fallback'
    }
    fitAddon.fit()

    const cursorStyleDisposable = agentId === 'codex'
      ? terminal.parser.registerCsiHandler({ intermediates: ' ', final: 'q' }, () => true)
      : undefined
    const codexPrivateModeOnDisposable = agentId === 'codex'
      ? terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
          if (params.length === 1 && params[0] === 12) return true
          // Codex enables terminal mouse reporting, which makes xterm require
          // Shift+drag for text selection. Keep normal left-drag selection in
          // the desktop shell by declining Codex mouse tracking modes.
          return params.length > 0 && params.every((param) => (
            typeof param === 'number' && CODEX_MOUSE_TRACKING_MODES.has(param)
          ))
        })
      : undefined
    const codexPrivateModeOffDisposable = agentId === 'codex'
      ? terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
          if (params.length === 1 && params[0] === 12) return true
          return params.length > 0 && params.every((param) => (
            typeof param === 'number' && CODEX_MOUSE_TRACKING_MODES.has(param)
          ))
        })
      : undefined

    const disposeIme = attachImeOverlay(terminal, id)
    let lastActivityReport = 0
    const reportActivity = (): void => {
      const now = Date.now()
      if (now - lastActivityReport < 1000) return
      lastActivityReport = now
      activityRef.current()
    }
    let interactionState: 'running' | 'processing' | 'needs_attention' = 'running'
    const inputDisposable = terminal.onData((data) => {
      reportActivity()
      window.cliAgent.writePty(id, data)
      if (!activityStatusEnabledRef.current || purpose !== 'session') return
      if (/[\r\n]/.test(data)) reportInteractionState('processing', 'Request submitted')
      else if (interactionState === 'needs_attention') reportInteractionState('running')
    })
    let started = false
    let disposed = false
    let receivedData = false
    let runningReported = false
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let resizeFrame: number | undefined
    let lastObservedWidth = 0
    let lastObservedHeight = 0
    let keepBottomUntil = 0
    const startingIndicatorShownAt = performance.now()
    let fallbackReadyTimer: ReturnType<typeof setTimeout> | undefined
    let minimumIndicatorTimer: ReturnType<typeof setTimeout> | undefined
    const reportRunning = (): void => {
      if (runningReported || disposed) return
      const remainingIndicatorTime = MIN_STARTING_INDICATOR_MS - (performance.now() - startingIndicatorShownAt)
      if (remainingIndicatorTime > 0) {
        clearTimeout(minimumIndicatorTimer)
        minimumIndicatorTimer = setTimeout(reportRunning, remainingIndicatorTime)
        return
      }
      runningReported = true
      clearTimeout(fallbackReadyTimer)
      if (interactionState === 'running') stateChangeRef.current('running')
    }
    const reportInteractionState = (state: typeof interactionState, detail?: string): void => {
      if (!activityStatusEnabledRef.current || purpose !== 'session' || disposed) return
      interactionState = state
      stateChangeRef.current(state, detail)
    }
    const offData = window.cliAgent.onPtyData(id, (data) => {
      reportActivity()
      receivedData = true
      terminal.write(data)
      if (started) reportRunning()
    })
    const writeParsedDisposable = terminal.onWriteParsed(() => {
      if (performance.now() <= keepBottomUntil) terminal.scrollToBottom()
    })
    const offExit = window.cliAgent.onPtyExit(id, (exitCode) => {
      terminal.write(`\r\n\x1b[90m[process exited: ${exitCode}]\x1b[0m\r\n`)
      stateChangeRef.current('stopped', `exit ${exitCode}`)
    })
    const offAttention = window.cliAgent.onPtyAttention(id, (reason) => {
      reportInteractionState('needs_attention', reason)
    })
    const cancelBottomLock = (): void => {
      keepBottomUntil = 0
    }
    const onUserWheel = (event: WheelEvent): void => {
      if (event.deltaY < 0) cancelBottomLock()
    }
    container.addEventListener('wheel', onUserWheel, { passive: true })

    const pasteClipboard = (): void => {
      void window.cliAgent.readTerminalClipboard().then((content) => {
        if (content.kind === 'text') window.cliAgent.writePty(id, content.value)
        if (content.kind === 'image') {
          const paths = content.values?.length ? content.values : [content.value]
          window.cliAgent.writePty(id, paths.map((path) => `"${path}"`).join(' '))
        }
      })
    }
    const textarea = terminal.textarea
    const onPaste = (event: ClipboardEvent): void => {
      if (event.clipboardData?.getData('text/plain')) return
      event.preventDefault()
      event.stopImmediatePropagation()
      pasteClipboard()
    }
    textarea?.addEventListener('paste', onPaste, true)

    const copySelection = (): boolean => {
      const selection = terminal.getSelection()
      if (!selection) return false
      window.cliAgent.writeTerminalClipboard(selection)
      return true
    }

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      if (event.key === 'PageUp' || event.key === 'Home') cancelBottomLock()
      if (
        agentId === 'codex'
        && event.key === 'Enter'
        && event.shiftKey
        && !event.ctrlKey
        && !event.altKey
        && !event.metaKey
        && !event.isComposing
      ) {
        // xterm.js 5.5 collapses Shift+Enter to CR. Codex treats LF (Ctrl+J) as
        // an inserted newline, so preserve the expected multiline shortcut.
        reportActivity()
        window.cliAgent.writePty(id, '\n')
        return false
      }
      if (
        (event.ctrlKey || event.metaKey)
        && !event.altKey
        && event.code === 'KeyC'
        && copySelection()
      ) {
        return false
      }
      return true
    })

    const resize = (): void => {
      const width = Math.round(container.clientWidth)
      const height = Math.round(container.clientHeight)
      if (width < 40 || height < 40) return
      if (width === lastObservedWidth && height === lastObservedHeight) return
      lastObservedWidth = width
      lastObservedHeight = height
      clearTimeout(resizeTimer)
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
      resizeTimer = setTimeout(() => {
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = undefined
          if (disposed || container.clientWidth < 40 || container.clientHeight < 40) return

          const before = terminal.buffer.active
          const distanceFromBottom = Math.max(0, before.baseY - before.viewportY)
          const wasAtBottom = distanceFromBottom <= 1 || performance.now() <= keepBottomUntil
          const previousCols = terminal.cols
          const previousRows = terminal.rows
          if (wasAtBottom) terminal.scrollToBottom()
          fitAddon.fit()
          if (started && (terminal.cols !== previousCols || terminal.rows !== previousRows)) {
            window.cliAgent.resizePty(id, terminal.cols, terminal.rows)
          }

          if (wasAtBottom) {
            keepBottomUntil = performance.now() + 600
            terminal.scrollToBottom()
          } else {
            const after = terminal.buffer.active
            terminal.scrollToLine(Math.max(0, after.baseY - distanceFromBottom))
          }
        })
      }, 24)
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)

    stateChangeRef.current('starting')
    void window.cliAgent.startPty({
      id,
      sessionId,
      agentId,
      cwd,
      title,
      account,
      purpose,
      resumeId,
      cols: terminal.cols,
      rows: terminal.rows,
    }).then(() => {
      started = true
      ptyReadyRef.current = true
      if (disposed) {
        window.cliAgent.stopPty(id)
        return
      }
      if (receivedData) reportRunning()
      else fallbackReadyTimer = setTimeout(reportRunning, 1800)
      if (activeRef.current) requestTerminalFocus(id, () => {
        if (!disposed) terminal.focus()
      })
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      terminal.writeln(`\x1b[31mUnable to start session: ${message}\x1b[0m`)
      stateChangeRef.current('stopped', message)
    })

    return () => {
      disposed = true
      clearTimeout(resizeTimer)
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
      clearTimeout(fallbackReadyTimer)
      clearTimeout(minimumIndicatorTimer)
      resizeObserver.disconnect()
      cursorStyleDisposable?.dispose()
      codexPrivateModeOnDisposable?.dispose()
      codexPrivateModeOffDisposable?.dispose()
      webglContextLossDisposable?.dispose()
      webglAddon?.dispose()
      disposeIme()
      cancelTerminalFocus(id)
      inputDisposable.dispose()
      offData()
      offExit()
      offAttention()
      writeParsedDisposable.dispose()
      container.removeEventListener('wheel', onUserWheel)
      textarea?.removeEventListener('paste', onPaste, true)
      window.cliAgent.stopPty(id)
      terminal.dispose()
      delete container.dataset.renderer
      terminalRef.current = null
      fitAddonRef.current = null
      ptyIdRef.current = ''
      ptyReadyRef.current = false
    }
  }, [sessionId, agentId, cwd, title, account?.id, purpose, resumeId])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.cursorBlink = active
    if (!active) return

    let cancelFocus = (): void => undefined
    const frame = requestAnimationFrame(() => {
      const currentTerminal = terminalRef.current
      const currentFitAddon = fitAddonRef.current
      if (!currentTerminal || !currentFitAddon) return
      currentFitAddon.fit()
      currentTerminal.refresh(0, Math.max(0, currentTerminal.rows - 1))
      if (ptyReadyRef.current && ptyIdRef.current) {
        window.cliAgent.resizePty(ptyIdRef.current, currentTerminal.cols, currentTerminal.rows)
      }
      cancelFocus = requestTerminalFocus(ptyIdRef.current, () => terminalRef.current?.focus())
    })
    return () => {
      cancelAnimationFrame(frame)
      cancelFocus()
    }
  }, [active])

  useEffect(() => {
    if (!active || !revealLatestAt) return undefined
    let cancelFocus = (): void => undefined
    const frame = requestAnimationFrame(() => {
      const terminal = terminalRef.current
      if (!terminal) return
      terminal.scrollToBottom()
      cancelFocus = requestTerminalFocus(ptyIdRef.current, () => terminalRef.current?.focus())
    })
    const timer = window.setTimeout(() => terminalRef.current?.scrollToBottom(), 80)
    return () => {
      cancelAnimationFrame(frame)
      cancelFocus()
      window.clearTimeout(timer)
    }
  }, [active, revealLatestAt])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.fontFamily = fontFamily
    terminal.options.fontSize = fontSize
    terminal.options.theme = { ...terminal.options.theme, background, foreground, cursor: cursorColor }
    requestAnimationFrame(() => {
      if (!terminalRef.current || !fitAddonRef.current) return
      fitAddonRef.current.fit()
      terminal.refresh(0, Math.max(0, terminal.rows - 1))
      if (ptyReadyRef.current && ptyIdRef.current) {
        window.cliAgent.resizePty(ptyIdRef.current, terminal.cols, terminal.rows)
      }
    })
  }, [fontFamily, fontSize, background, foreground, cursorColor])

  return <div className="terminal-container" ref={containerRef} />
}

function terminalPanePropsEqual(previous: TerminalPaneProps, next: TerminalPaneProps): boolean {
  return previous.active === next.active
    && previous.sessionId === next.sessionId
    && previous.agentId === next.agentId
    && previous.cwd === next.cwd
    && previous.title === next.title
    && previous.account?.id === next.account?.id
    && previous.purpose === next.purpose
    && previous.resumeId === next.resumeId
    && previous.revealLatestAt === next.revealLatestAt
    && previous.fontFamily === next.fontFamily
    && previous.fontSize === next.fontSize
    && previous.background === next.background
    && previous.foreground === next.foreground
    && previous.cursorColor === next.cursorColor
    && previous.activityStatusEnabled === next.activityStatusEnabled
}

export const TerminalPane = memo(TerminalPaneComponent, terminalPanePropsEqual)

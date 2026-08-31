import { memo, useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { attachImeLifecycle } from './ime-lifecycle'
import { beginTerminalComposition, cancelTerminalFocus, endTerminalComposition, requestTerminalFocus } from './ime-focus'
import { isTerminalPasteShortcut } from './terminal-clipboard'
import { createTerminalOptions } from './terminal-options'
import { attachTerminalPaste } from './terminal-paste'
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
  renderer: 'dom' | 'webgl'
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

const MIN_STARTING_INDICATOR_MS = 650
const INACTIVE_OUTPUT_FLUSH_MS = 250
const STARTUP_FOLLOW_WINDOW_MS = 15_000
const STARTUP_FOLLOW_EXTEND_MS = 1200
const TERMINAL_ZOOM_KEYS = new Set(['=', '+', '-', '_', '0'])
const CODEX_MOUSE_TRACKING_MODES = new Set([9, 1000, 1002, 1003, 1005, 1006, 1015, 1016])

function TerminalPaneComponent({ active, sessionId, agentId, cwd, title, account, purpose = 'session', resumeId, renderer, revealLatestAt, fontFamily, fontSize, background, foreground, cursorColor, activityStatusEnabled, onActivity, onStateChange }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const flushInactiveOutputRef = useRef<() => void>(() => undefined)
  const clearAttentionRef = useRef<() => void>(() => undefined)
  const openSearchRef = useRef<() => void>(() => undefined)
  const ptyIdRef = useRef('')
  const ptyReadyRef = useRef(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  openSearchRef.current = () => {
    setSearchOpen(true)
    requestAnimationFrame(() => searchInputRef.current?.select())
  }
  const closeSearch = (): void => {
    setSearchOpen(false)
    terminalRef.current?.clearSelection()
    terminalRef.current?.focus()
  }
  const findInTerminal = (direction: 'next' | 'previous', query = searchQuery): void => {
    if (!query) return
    if (direction === 'next') searchAddonRef.current?.findNext(query)
    else searchAddonRef.current?.findPrevious(query)
  }
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
    const terminal = new Terminal(createTerminalOptions({
      fontFamily,
      fontSize,
      background,
      foreground,
      cursorColor,
    }, activeRef.current))
    terminalRef.current = terminal
    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    ptyIdRef.current = id
    terminal.loadAddon(fitAddon)
    const searchAddon = new SearchAddon()
    terminal.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon
    terminal.loadAddon(new WebLinksAddon((event, uri) => {
      event.preventDefault()
      window.cliAgent.openExternal(uri)
    }))
    terminal.open(container)
    // The built-in DOM renderer is the reliable default around Windows IME
    // composition and resize; the WebGL addon is attached by its own effect
    // when the GPU renderer is selected in appearance settings.
    container.dataset.renderer = 'default'
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

    const disposeIme = attachImeLifecycle(terminal.textarea, {
      begin: () => beginTerminalComposition(id),
      end: () => endTerminalComposition(id),
      refresh: () => terminal.refresh(0, Math.max(0, terminal.rows - 1)),
    })
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
    let startupFollowDeadline = 0
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
    clearAttentionRef.current = () => {
      if (interactionState === 'needs_attention') reportInteractionState('running')
    }
    let pendingInactiveOutput = ''
    let pendingInactiveFlushTimer: ReturnType<typeof setTimeout> | undefined
    const flushInactiveOutput = (): void => {
      clearTimeout(pendingInactiveFlushTimer)
      pendingInactiveFlushTimer = undefined
      if (disposed || !pendingInactiveOutput) return
      const output = pendingInactiveOutput
      pendingInactiveOutput = ''
      terminal.write(output)
    }
    flushInactiveOutputRef.current = flushInactiveOutput
    const offData = window.cliAgent.onPtyData(id, (data) => {
      reportActivity()
      if (!receivedData) {
        receivedData = true
        // Pin the viewport to the newest output while the CLI restores its
        // screen (resume replays, startup banners); scrolling up releases it.
        startupFollowDeadline = performance.now() + STARTUP_FOLLOW_WINDOW_MS
      }
      if (performance.now() <= startupFollowDeadline) {
        keepBottomUntil = Math.max(keepBottomUntil, performance.now() + STARTUP_FOLLOW_EXTEND_MS)
      }
      if (activeRef.current) {
        flushInactiveOutput()
        terminal.write(data)
      } else {
        // Hidden terminals coalesce output so busy background sessions do not
        // steal frame time from the session being typed into.
        pendingInactiveOutput += data
        pendingInactiveFlushTimer ??= setTimeout(flushInactiveOutput, INACTIVE_OUTPUT_FLUSH_MS)
      }
      if (started) reportRunning()
    })
    const writeParsedDisposable = terminal.onWriteParsed(() => {
      if (performance.now() <= keepBottomUntil) terminal.scrollToBottom()
    })
    const offExit = window.cliAgent.onPtyExit(id, (exitCode) => {
      flushInactiveOutput()
      terminal.write(`\r\n\x1b[90m[process exited: ${exitCode}]\x1b[0m\r\n`)
      stateChangeRef.current('stopped', `exit ${exitCode}`)
    })
    const offAttention = window.cliAgent.onPtyAttention(id, (reason) => {
      // The user is already looking at an active pane, so amber attention
      // styling there is noise (Codex signals after every turn).
      if (activeRef.current) return
      reportInteractionState('needs_attention', reason)
    })
    const cancelBottomLock = (): void => {
      keepBottomUntil = 0
      startupFollowDeadline = 0
    }
    const onUserWheel = (event: WheelEvent): void => {
      if (event.ctrlKey) return
      if (event.deltaY < 0) cancelBottomLock()
    }
    container.addEventListener('wheel', onUserWheel, { passive: true })

    const textarea = terminal.textarea
    const pasteControls = attachTerminalPaste(textarea, {
      paste: (text) => terminal.paste(text),
      readClipboard: () => window.cliAgent.readTerminalClipboard(),
    })

    const copySelection = (): boolean => {
      const selection = terminal.getSelection()
      if (!selection) return false
      window.cliAgent.writeTerminalClipboard(selection)
      return true
    }

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      if (event.key === 'PageUp' || event.key === 'Home') cancelBottomLock()
      if (isTerminalPasteShortcut(event)) {
        // Handle the paste ourselves; the raw Ctrl+V byte must never reach
        // the CLI (Codex binds it to image paste and reads the clipboard again).
        event.preventDefault()
        reportActivity()
        pasteControls.pasteFromClipboard()
        return false
      }
      if (
        event.key === 'Tab'
        && event.shiftKey
        && !event.ctrlKey
        && !event.altKey
        && !event.metaKey
        && !event.isComposing
      ) {
        // Send CSI Z directly: ConPTY translates it into a proper Shift+Tab
        // for the CLI, and nothing between the browser and xterm can drop it.
        event.preventDefault()
        reportActivity()
        window.cliAgent.writePty(id, '\x1b[Z')
        return false
      }
      if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.code === 'KeyF') {
        event.preventDefault()
        openSearchRef.current()
        return false
      }
      if (
        event.ctrlKey && !event.altKey && !event.metaKey
        && (
          // Handled by app-level shortcuts: terminal zoom and tab switching.
          TERMINAL_ZOOM_KEYS.has(event.key)
          || event.key === 'Tab'
          || (!event.shiftKey && /^[1-9]$/.test(event.key))
        )
      ) {
        return false
      }
      if (
        agentId === 'codex'
        && event.key === 'Enter'
        && event.shiftKey
        && !event.ctrlKey
        && !event.altKey
        && !event.metaKey
        && !event.isComposing
      ) {
        // xterm.js 5.5 collapses Shift+Enter to CR, and writing LF instead
        // reaches the CLI as Ctrl+Enter after ConPTY's translation. Sending a
        // win32-input-mode key event (VK_RETURN with SHIFT down, then up)
        // delivers a real Shift+Enter, which Codex maps to a newline.
        reportActivity()
        window.cliAgent.writePty(id, '\x1b[13;28;13;1;16;1_\x1b[13;28;13;0;16;1_')
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
      clearTimeout(pendingInactiveFlushTimer)
      flushInactiveOutputRef.current = () => undefined
      clearAttentionRef.current = () => undefined
      resizeObserver.disconnect()
      cursorStyleDisposable?.dispose()
      codexPrivateModeOnDisposable?.dispose()
      codexPrivateModeOffDisposable?.dispose()
      disposeIme()
      cancelTerminalFocus(id)
      inputDisposable.dispose()
      offData()
      offExit()
      offAttention()
      writeParsedDisposable.dispose()
      container.removeEventListener('wheel', onUserWheel)
      pasteControls.dispose()
      window.cliAgent.stopPty(id)
      terminal.dispose()
      delete container.dataset.renderer
      terminalRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
      ptyIdRef.current = ''
      ptyReadyRef.current = false
    }
  }, [sessionId, agentId, cwd, title, account?.id, purpose, resumeId])

  useEffect(() => {
    if (renderer !== 'webgl') return undefined
    const container = containerRef.current
    const terminal = terminalRef.current
    if (!container || !terminal) return undefined
    let cancelled = false
    let addon: WebglAddon | undefined
    void import('@xterm/addon-webgl').then(({ WebglAddon: Webgl }) => {
      if (cancelled || terminalRef.current !== terminal) return
      try {
        const webgl = new Webgl()
        webgl.onContextLoss(() => {
          // Fall back to the DOM renderer when the GPU context is lost.
          webgl.dispose()
          if (addon === webgl) addon = undefined
          container.dataset.renderer = 'default'
        })
        terminal.loadAddon(webgl)
        addon = webgl
        container.dataset.renderer = 'webgl'
      } catch {
        container.dataset.renderer = 'default'
      }
    })
    return () => {
      cancelled = true
      try {
        addon?.dispose()
      } catch {
        // The terminal may already have disposed the addon with itself.
      }
      addon = undefined
      container.dataset.renderer = 'default'
    }
  }, [renderer, sessionId, agentId, cwd, title, account?.id, purpose, resumeId])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.cursorBlink = active
    if (!active) return
    flushInactiveOutputRef.current()
    // Opening the session answers its pending attention signal.
    clearAttentionRef.current()

    let cancelFocus = (): void => undefined
    const frame = requestAnimationFrame(() => {
      const currentTerminal = terminalRef.current
      const currentFitAddon = fitAddonRef.current
      if (!currentTerminal || !currentFitAddon) return
      const before = currentTerminal.buffer.active
      const distanceFromBottom = Math.max(0, before.baseY - before.viewportY)
      const previousCols = currentTerminal.cols
      const previousRows = currentTerminal.rows
      currentFitAddon.fit()
      currentTerminal.refresh(0, Math.max(0, currentTerminal.rows - 1))
      if (distanceFromBottom <= 1) {
        currentTerminal.scrollToBottom()
      } else {
        const after = currentTerminal.buffer.active
        currentTerminal.scrollToLine(Math.max(0, after.baseY - distanceFromBottom))
      }
      if (
        ptyReadyRef.current
        && ptyIdRef.current
        && (currentTerminal.cols !== previousCols || currentTerminal.rows !== previousRows)
      ) {
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
      const currentTerminal = terminalRef.current
      const fitAddon = fitAddonRef.current
      if (!currentTerminal || !fitAddon) return
      const before = currentTerminal.buffer.active
      const distanceFromBottom = Math.max(0, before.baseY - before.viewportY)
      fitAddon.fit()
      currentTerminal.refresh(0, Math.max(0, currentTerminal.rows - 1))
      if (distanceFromBottom <= 1) {
        currentTerminal.scrollToBottom()
      } else {
        const after = currentTerminal.buffer.active
        currentTerminal.scrollToLine(Math.max(0, after.baseY - distanceFromBottom))
      }
      if (ptyReadyRef.current && ptyIdRef.current) {
        window.cliAgent.resizePty(ptyIdRef.current, currentTerminal.cols, currentTerminal.rows)
      }
    })
  }, [fontFamily, fontSize, background, foreground, cursorColor])

  return (
    <div className="terminal-pane">
      <div className="terminal-container" ref={containerRef} />
      {searchOpen && (
        <div className="terminal-search" role="search">
          <input
            ref={searchInputRef}
            autoFocus
            aria-label="Find in terminal"
            placeholder="Find in terminal"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value)
              if (event.target.value) searchAddonRef.current?.findNext(event.target.value, { incremental: true })
              else terminalRef.current?.clearSelection()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') findInTerminal(event.shiftKey ? 'previous' : 'next')
              if (event.key === 'Escape') closeSearch()
            }}
          />
          <button title="Previous match (Shift+Enter)" onClick={() => findInTerminal('previous')}><ChevronUp size={13} /></button>
          <button title="Next match (Enter)" onClick={() => findInTerminal('next')}><ChevronDown size={13} /></button>
          <button title="Close (Esc)" onClick={closeSearch}><X size={13} /></button>
        </div>
      )}
    </div>
  )
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
    && previous.renderer === next.renderer
    && previous.revealLatestAt === next.revealLatestAt
    && previous.fontFamily === next.fontFamily
    && previous.fontSize === next.fontSize
    && previous.background === next.background
    && previous.foreground === next.foreground
    && previous.cursorColor === next.cursorColor
    && previous.activityStatusEnabled === next.activityStatusEnabled
}

export const TerminalPane = memo(TerminalPaneComponent, terminalPanePropsEqual)

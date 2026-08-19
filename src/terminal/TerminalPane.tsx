import { useEffect, useRef } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { attachImeOverlay } from './ime-overlay'
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
  onActivity: () => void
  onStateChange: (state: 'starting' | 'running' | 'stopped', detail?: string) => void
}

const ACTIVE_SCROLLBACK = 5000
const BACKGROUND_SCROLLBACK = 1500
const MIN_STARTING_INDICATOR_MS = 650

export function TerminalPane({ active, sessionId, agentId, cwd, title, account, purpose = 'session', resumeId, onActivity, onStateChange }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const activeRef = useRef(active)
  const activityRef = useRef(onActivity)
  activeRef.current = active
  activityRef.current = onActivity

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const id = crypto.randomUUID()
    const terminal = new Terminal({
      cursorBlink: activeRef.current,
      cursorStyle: 'bar',
      fontFamily: 'JetBrains Mono, D2Coding, Cascadia Mono, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.3,
      scrollback: activeRef.current ? ACTIVE_SCROLLBACK : BACKGROUND_SCROLLBACK,
      allowTransparency: true,
      allowProposedApi: false,
      theme: {
        background: 'rgba(0,0,0,0)',
        foreground: '#C9D0D4',
        cursor: '#F3B33D',
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
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    fitAddon.fit()

    const cursorStyleDisposable = agentId === 'codex'
      ? terminal.parser.registerCsiHandler({ intermediates: ' ', final: 'q' }, () => true)
      : undefined
    const cursorBlinkOnDisposable = agentId === 'codex'
      ? terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => params.length === 1 && params[0] === 12)
      : undefined
    const cursorBlinkOffDisposable = agentId === 'codex'
      ? terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => params.length === 1 && params[0] === 12)
      : undefined

    const disposeIme = attachImeOverlay(terminal)
    let lastActivityReport = 0
    const reportActivity = (): void => {
      const now = Date.now()
      if (now - lastActivityReport < 1000) return
      lastActivityReport = now
      activityRef.current()
    }
    const inputDisposable = terminal.onData((data) => {
      reportActivity()
      window.cliAgent.writePty(id, data)
    })
    let started = false
    let disposed = false
    let receivedData = false
    let runningReported = false
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let bottomSettleTimer: ReturnType<typeof setTimeout> | undefined
    let bottomSettleFrame: number | undefined
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
      onStateChange('running')
    }
    const offData = window.cliAgent.onPtyData(id, (data) => {
      reportActivity()
      receivedData = true
      const keepAtBottom = performance.now() <= keepBottomUntil
      terminal.write(data, keepAtBottom ? () => terminal.scrollToBottom() : undefined)
      if (started) reportRunning()
    })
    const offExit = window.cliAgent.onPtyExit(id, (exitCode) => {
      terminal.write(`\r\n\x1b[90m[process exited: ${exitCode}]\x1b[0m\r\n`)
      onStateChange('stopped', `exit ${exitCode}`)
    })

    const pasteClipboard = (): void => {
      void window.cliAgent.readTerminalClipboard().then((content) => {
        if (content.kind === 'text') window.cliAgent.writePty(id, content.value)
        if (content.kind === 'image') {
          const paths = content.values?.length ? content.values : [content.value]
          window.cliAgent.writePty(id, paths.map((path) => `"${path}"`).join(' '))
        }
      })
    }

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyC' && terminal.hasSelection()) {
        void navigator.clipboard.writeText(terminal.getSelection())
        return false
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyV') {
        pasteClipboard()
        return false
      }
      return true
    })

    const resize = (): void => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (disposed || container.clientWidth < 40 || container.clientHeight < 40) return
        const buffer = terminal.buffer.active
        const wasAtBottom = buffer.viewportY >= buffer.baseY
        fitAddon.fit()
        if (started) window.cliAgent.resizePty(id, terminal.cols, terminal.rows)
        if (!wasAtBottom) return

        keepBottomUntil = performance.now() + 180
        terminal.scrollToBottom()
        if (bottomSettleFrame !== undefined) cancelAnimationFrame(bottomSettleFrame)
        bottomSettleFrame = requestAnimationFrame(() => terminal.scrollToBottom())
        clearTimeout(bottomSettleTimer)
        bottomSettleTimer = setTimeout(() => terminal.scrollToBottom(), 90)
      }, 40)
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)

    onStateChange('starting')
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
      if (disposed) {
        window.cliAgent.stopPty(id)
        return
      }
      if (receivedData) reportRunning()
      else fallbackReadyTimer = setTimeout(reportRunning, 1800)
      if (activeRef.current) terminal.focus()
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      terminal.writeln(`\x1b[31mUnable to start session: ${message}\x1b[0m`)
      onStateChange('stopped', message)
    })

    return () => {
      disposed = true
      clearTimeout(resizeTimer)
      clearTimeout(bottomSettleTimer)
      if (bottomSettleFrame !== undefined) cancelAnimationFrame(bottomSettleFrame)
      clearTimeout(fallbackReadyTimer)
      clearTimeout(minimumIndicatorTimer)
      resizeObserver.disconnect()
      cursorStyleDisposable?.dispose()
      cursorBlinkOnDisposable?.dispose()
      cursorBlinkOffDisposable?.dispose()
      disposeIme()
      inputDisposable.dispose()
      offData()
      offExit()
      window.cliAgent.stopPty(id)
      terminal.dispose()
      terminalRef.current = null
    }
  }, [sessionId, agentId, cwd, title, account?.id, purpose, resumeId])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.cursorBlink = active
    terminal.options.scrollback = active ? ACTIVE_SCROLLBACK : BACKGROUND_SCROLLBACK
    if (active) terminal.focus()
  }, [active])

  return <div className="terminal-container" ref={containerRef} />
}

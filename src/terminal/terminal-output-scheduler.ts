import { createTerminalOutputClock, type OutputClock } from './terminal-output-clock'

interface OutputPort {
  active: () => boolean
  write: (data: string, parsed: () => void) => void
  acknowledge: (through: number) => void
  failed: (error: unknown) => void
}
interface Chunk { data: string; through?: number }
interface Entry { port: OutputPort; chunks: Chunk[]; disposed: boolean }

// Owns the renderer's output budget across terminals. One bounded xterm write is
// parsed at a time; every continuation yields to keyboard/composition events.
export class TerminalOutputScheduler {
  private entries: Entry[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private inFlight: { entry: Entry } | undefined
  private inputUntil = 0
  private foregroundRuns = 0

  constructor(private readonly clock: OutputClock = createTerminalOutputClock()) {}

  register(port: OutputPort) {
    const entry: Entry = { port, chunks: [], disposed: false }
    this.entries.push(entry)
    return {
      enqueue: (data: string, through?: number) => {
        if (entry.disposed || !data) return
        entry.chunks.push({ data, through })
        this.schedule()
      },
      noteInput: () => { this.inputUntil = this.clock.now() + 120 },
      wake: () => this.schedule(),
      dispose: () => {
        entry.disposed = true
        entry.chunks = []
        this.entries = this.entries.filter(item => item !== entry)
        // xterm.dispose can suppress its pending callback. Release that slot;
        // a late callback is identified by the old token and cannot ACK new data.
        if (this.inFlight?.entry === entry) this.inFlight = undefined
        if (!this.entries.length && this.timer !== undefined) {
          this.clock.cancel(this.timer); this.timer = undefined
        }
        if (!this.entries.length) this.clock.dispose?.()
        this.schedule()
      },
    }
  }

  private schedule(): void {
    if (this.inFlight) return
    const waiting = this.entries.filter(entry => entry.chunks.length)
    if (!waiting.length) return
    if (this.timer !== undefined) return
    this.timer = this.clock.schedule(() => { this.timer = undefined; this.drain() })
  }

  private drain(): void {
    if (this.inFlight) return
    const waiting = this.entries.filter(entry => entry.chunks.length)
    const foreground = waiting.find(entry => entry.port.active())
    const background = waiting.find(entry => !entry.port.active())
    // The foreground gets first choice, but continuous foreground output must
    // not starve background completions and their final bytes.
    const entry = foreground && (!background || this.foregroundRuns < 4) ? foreground : background
    if (!entry) return
    this.foregroundRuns = entry === foreground ? this.foregroundRuns + 1 : 0
    const limit = entry.port.active() ? 8 * 1024 : this.clock.now() < this.inputUntil ? 4 * 1024 : 8 * 1024
    const chunk = entry.chunks[0]
    // Avoid introducing a new surrogate split. Original PTY chunks may already
    // have split Unicode; xterm's streaming decoder handles those boundaries.
    let length = Math.min(limit, chunk.data.length)
    const last = chunk.data.charCodeAt(length - 1)
    if (length < chunk.data.length && last >= 0xd800 && last <= 0xdbff) length--
    const data = chunk.data.slice(0, length)
    const through = chunk.through === undefined ? undefined : chunk.through - chunk.data.length + length
    chunk.data = chunk.data.slice(length)
    if (!chunk.data) entry.chunks.shift()
    // Rotate after each write for fair service among background tabs.
    this.entries = [...this.entries.filter(item => item !== entry), entry]
    const token = { entry }
    this.inFlight = token
    try {
      entry.port.write(data, () => {
        if (this.inFlight !== token) return
        this.inFlight = undefined
        try {
          if (!entry.disposed && through !== undefined) entry.port.acknowledge(through)
        } catch (error) { this.fail(entry, error) }
        this.schedule()
      })
    } catch (error) {
      if (this.inFlight === token) this.inFlight = undefined
      this.fail(entry, error)
      this.schedule()
    }
  }

  private fail(entry: Entry, error: unknown): void {
    entry.disposed = true
    entry.chunks = []
    this.entries = this.entries.filter(item => item !== entry)
    if (!this.entries.length) this.clock.dispose?.()
    entry.port.failed(error)
  }
}

// Explicit renderer-scoped controller, shared by all mounted terminal panes.
export const terminalOutputScheduler = new TerminalOutputScheduler()

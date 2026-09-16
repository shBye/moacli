import { appendFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { diagnosticEventSchema, type TerminalDiagnosticEvent } from '../src/shared/terminal-diagnostics'

const MAX_FILE_BYTES = 2 * 1024 * 1024

export class TerminalDiagnosticStore {
  private pending = Promise.resolve()
  private queued = 0
  private lostBatches = 0
  private writeFailed = false
  private recent: TerminalDiagnosticEvent[] = []
  private incident: TerminalDiagnosticEvent[] | null = null
  private incidentTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly directory: string, private readonly now: () => number = Date.now) {}

  accept(payload: unknown): void {
    if (!Array.isArray(payload) || payload.length > 100) return
    const events = payload.flatMap((value) => {
      const result = diagnosticEventSchema.safeParse(value)
      return result.success ? [result.data] : []
    })
    if (!events.length) return
    for (const event of events) {
      if ((event.jump || event.reason === 'user-mark') && !this.incident) {
        this.incident = [...this.recent]
        this.incidentTimer = setTimeout(() => this.finishIncident(), 2000)
      }
      if (this.incident && this.incident.length < 1200) this.incident.push(event)
      this.recent.push(event)
      if (this.recent.length > 200) this.recent.shift()
    }
    this.enqueue('recent', events.map((event) => JSON.stringify(event)).join('\n') + '\n')
  }

  private finishIncident(): void {
    clearTimeout(this.incidentTimer)
    this.incidentTimer = undefined
    if (!this.incident) return
    const data = JSON.stringify({ capturedAt: this.now(), events: this.incident }) + '\n'
    this.incident = null
    this.enqueue('incidents', data)
  }

  private enqueue(name: string, data: string): void {
    if (this.queued >= 32) { this.lostBatches++; return }
    this.queued++
    this.pending = this.pending.then(async () => {
      await mkdir(this.directory, { recursive: true })
      const file = join(this.directory, `${name}.jsonl`)
      const size = await stat(file).then((value) => value.size).catch(() => 0)
      if (size + Buffer.byteLength(data) > MAX_FILE_BYTES) {
        const previous = join(this.directory, `${name}.previous.jsonl`)
        await unlink(previous).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
        await rename(file, previous).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
      }
      await appendFile(file, data, 'utf8')
    }).catch(() => { this.writeFailed = true }).finally(() => { this.queued-- })
  }

  async snapshot(): Promise<object> {
    this.finishIncident()
    await this.pending
    const files: Record<string, unknown[]> = {}
    for (const name of ['recent.previous', 'recent', 'incidents.previous', 'incidents']) {
      const text = await readFile(join(this.directory, `${name}.jsonl`), 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') this.writeFailed = true
        return ''
      })
      files[name] = text.split('\n').flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } })
    }
    return { format: 1, exportedAt: this.now(), writeFailed: this.writeFailed, lostBatches: this.lostBatches,
      memoryRecent: [...this.recent], files }
  }

  async close(): Promise<void> { this.finishIncident(); await this.pending }
}

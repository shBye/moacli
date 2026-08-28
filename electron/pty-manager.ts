import { constants as osConstants, setPriority } from 'node:os'
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import { scanOsc9 } from './osc9-scanner'
import type { PtySpawnSpec } from './pty-host-protocol'

const MAX_PTY_PROCESSES = 10
const OUTPUT_BATCH_DELAY_MS = 8
const MAX_OUTPUT_BATCH_LENGTH = 16 * 1024

export interface PtySinks {
  data: (id: string, data: string) => void
  exit: (id: string, exitCode: number, intentional: boolean) => void
  attention: (id: string, reason: string) => void
}

// Runs inside the PTY host utility process: owns the node-pty processes and
// output batching so terminal bytes never touch the Electron main process.
export class PtyManager {
  private readonly processes = new Map<string, IPty>()
  private readonly pendingOutput = new Map<string, string>()
  private readonly intentionalStops = new Set<string>()
  private readonly oscCarry = new Map<string, string>()
  private outputTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly sinks: PtySinks) {}

  spawn(spec: PtySpawnSpec): void {
    if (this.processes.has(spec.id)) throw new Error('Session is already running')
    if (this.processes.size >= MAX_PTY_PROCESSES) {
      throw new Error(`At most ${MAX_PTY_PROCESSES} CLI sessions can run at once`)
    }

    const instance = pty.spawn(spec.file, spec.args, {
      name: 'xterm-256color',
      cols: Math.max(20, spec.cols),
      rows: Math.max(5, spec.rows),
      cwd: spec.cwd,
      env: spec.env,
      useConpty: process.platform === 'win32',
      useConptyDll: process.platform === 'win32',
    } as pty.IPtyForkOptions & { useConpty: boolean; useConptyDll: boolean })

    this.processes.set(spec.id, instance)
    try {
      // Agent processes can saturate every core while working; below-normal
      // priority (inherited by their children) keeps the UI responsive then.
      setPriority(instance.pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
    } catch {
      // Best-effort: the process may have exited before the priority applied.
    }
    instance.onData((data) => {
      if (spec.scanOsc9) this.observeOsc9(spec.id, data)
      this.queueOutput(spec.id, data)
    })
    instance.onExit(({ exitCode }) => {
      this.flushOutput(spec.id, true)
      this.processes.delete(spec.id)
      this.oscCarry.delete(spec.id)
      const intentional = this.intentionalStops.delete(spec.id)
      this.sinks.exit(spec.id, exitCode, intentional)
    })
  }

  write(id: string, data: string): void {
    this.processes.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols < 2 || rows < 1) return
    this.processes.get(id)?.resize(cols, rows)
  }

  stop(id: string): void {
    const instance = this.processes.get(id)
    if (!instance) return
    this.intentionalStops.add(id)
    instance.kill()
    this.processes.delete(id)
    this.pendingOutput.delete(id)
    this.oscCarry.delete(id)
  }

  stopAll(): void {
    for (const id of [...this.processes.keys()]) this.stop(id)
    if (this.outputTimer) clearTimeout(this.outputTimer)
    this.outputTimer = undefined
    this.pendingOutput.clear()
  }

  private observeOsc9(id: string, data: string): void {
    const result = scanOsc9(data, this.oscCarry.get(id))
    if (result.carry) this.oscCarry.set(id, result.carry)
    else this.oscCarry.delete(id)
    for (const reason of result.messages) this.sinks.attention(id, reason)
  }

  private queueOutput(id: string, data: string): void {
    const output = (this.pendingOutput.get(id) ?? '') + data
    this.pendingOutput.set(id, output)
    this.scheduleOutputFlush()
  }

  private scheduleOutputFlush(): void {
    if (this.outputTimer || this.pendingOutput.size === 0) return
    this.outputTimer = setTimeout(() => {
      this.outputTimer = undefined
      for (const pendingId of [...this.pendingOutput.keys()]) this.flushOutput(pendingId)
      this.scheduleOutputFlush()
    }, OUTPUT_BATCH_DELAY_MS)
  }

  private flushOutput(id: string, drain = false): void {
    let data = this.pendingOutput.get(id)
    if (!data) return

    do {
      const chunk = data.slice(0, MAX_OUTPUT_BATCH_LENGTH)
      data = data.slice(chunk.length)
      this.sinks.data(id, chunk)
    } while (drain && data.length > 0)

    if (data.length > 0) this.pendingOutput.set(id, data)
    else this.pendingOutput.delete(id)
  }
}

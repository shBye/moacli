import { PtyOutputBuffer, PTY_OUTPUT_HIGH, PTY_OUTPUT_LOW } from './pty-output-buffer'
import { constants as osConstants, setPriority } from 'node:os'
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import { scanOsc9 } from './osc9-scanner'
import type { PtySpawnSpec } from './pty-host-protocol'

const MAX_PTY_PROCESSES = 10
const OUTPUT_BATCH_DELAY_MS = 8
const MAX_OUTPUT_BATCH_LENGTH = 16 * 1024

export interface PtySinks {
  data: (id: string, data: string, through: number) => void
  exit: (id: string, exitCode: number, intentional: boolean) => void
  attention: (id: string, reason: string) => void
}

// Runs inside the PTY host utility process: owns the node-pty processes and
// output batching so terminal bytes never touch the Electron main process.
export class PtyManager {
  private readonly processes = new Map<string, IPty>()
  private readonly pendingOutput = new Map<string, PtyOutputBuffer>()
  private readonly pausedOutput = new Set<string>()
  private readonly pendingExits = new Map<string, number>()
  private readonly intentionalStops = new Set<string>()
  private readonly oscCarry = new Map<string, string>()
  private outputTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly sinks: PtySinks) {}

  spawn(spec: PtySpawnSpec): void {
    if (this.processes.has(spec.id) || this.pendingOutput.has(spec.id)) throw new Error('Session is already running')
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
    this.pendingOutput.set(spec.id, new PtyOutputBuffer())
    try {
      // Agent processes can saturate every core while working; below-normal
      // priority (inherited by their children) keeps the UI responsive then.
      setPriority(instance.pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
    } catch {
      // Best-effort: the process may have exited before the priority applied.
    }
    instance.onData((data) => {
      if (this.intentionalStops.has(spec.id)) return
      if (spec.scanOsc9) this.observeOsc9(spec.id, data)
      this.queueOutput(spec.id, data)
    })
    instance.onExit(({ exitCode }) => {
      this.processes.delete(spec.id)
      this.oscCarry.delete(spec.id)
      this.pausedOutput.delete(spec.id)
      if (this.intentionalStops.delete(spec.id)) {
        this.pendingOutput.delete(spec.id)
        this.sinks.exit(spec.id, exitCode, true)
      } else {
        this.pendingExits.set(spec.id, exitCode)
        this.finishOutput(spec.id)
        this.scheduleOutputFlush()
      }
    })
  }

  acknowledgeOutput(id: string, through: number): void {
    const output = this.pendingOutput.get(id)
    if (!output) return
    output.acknowledge(through)
    if (this.pausedOutput.has(id) && output.backlog <= PTY_OUTPUT_LOW) {
      this.pausedOutput.delete(id)
      this.processes.get(id)?.resume()
    }
    this.finishOutput(id)
    this.scheduleOutputFlush()
  }

  write(id: string, data: string): void {
    this.processes.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols < 2 || rows < 1) return
    const instance = this.processes.get(id)
    if (!instance || (instance.cols === cols && instance.rows === rows)) return
    instance.resize(cols, rows)
  }

  stop(id: string): void {
    const instance = this.processes.get(id)
    if (!instance) {
      const exitCode = this.pendingExits.get(id)
      this.pendingExits.delete(id)
      this.pendingOutput.delete(id)
      if (exitCode !== undefined) this.sinks.exit(id, exitCode, true)
      return
    }
    if (this.intentionalStops.has(id)) return
    this.intentionalStops.add(id)
    if (this.pausedOutput.delete(id)) instance.resume()
    this.pendingOutput.delete(id)
    this.oscCarry.delete(id)
    instance.kill()
  }

  stopAll(): void {
    for (const id of new Set([...this.processes.keys(), ...this.pendingOutput.keys()])) this.stop(id)
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
    const output = this.pendingOutput.get(id)
    if (!output) return
    output.enqueue(data)
    if (output.backlog >= PTY_OUTPUT_HIGH && !this.pausedOutput.has(id)) {
      this.pausedOutput.add(id)
      this.processes.get(id)?.pause()
    }
    this.scheduleOutputFlush()
  }

  private scheduleOutputFlush(): void {
    if (this.outputTimer || ![...this.pendingOutput.values()].some(output => output.canSend)) return
    this.outputTimer = setTimeout(() => {
      this.outputTimer = undefined
      for (const [id, output] of this.pendingOutput) {
        const chunk = output.take(MAX_OUTPUT_BATCH_LENGTH)
        if (chunk) this.sinks.data(id, chunk.data, chunk.through)
      }
      this.scheduleOutputFlush()
    }, OUTPUT_BATCH_DELAY_MS)
  }

  private finishOutput(id: string): void {
    const exitCode = this.pendingExits.get(id)
    const output = this.pendingOutput.get(id)
    if (exitCode === undefined || (output && output.backlog > 0)) return
    this.pendingExits.delete(id)
    this.pendingOutput.delete(id)
    this.sinks.exit(id, exitCode, false)
  }
}

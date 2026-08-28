// Message contracts for the PTY host utility process. Hot-path terminal I/O
// (write/resize/data/exit) flows renderer <-> host over a direct MessagePort;
// the main process only participates in session start, stop bookkeeping, and
// attention signals.

export interface PtySpawnSpec {
  id: string
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
  scanOsc9: boolean
}

export type RendererToHostMessage =
  | { type: 'write'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  | { type: 'stop'; id: string }

export type HostToRendererMessage =
  | { type: 'data'; id: string; data: string }
  | { type: 'exit'; id: string; exitCode: number }

export type MainToHostMessage =
  | { type: 'spawn'; requestId: number; spec: PtySpawnSpec }
  | { type: 'stop'; id: string }
  | { type: 'renderer-port' }
  | { type: 'shutdown' }

export type HostToMainMessage =
  | { type: 'ready' }
  | { type: 'spawn-result'; requestId: number; error?: string }
  | { type: 'exit'; id: string; exitCode: number; intentional: boolean }
  | { type: 'attention'; id: string; reason: string }

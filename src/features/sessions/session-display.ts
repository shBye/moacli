import type { SessionState } from './types'

export function sessionStateLabel(state: SessionState): string {
  if (state === 'needs_attention') return 'Needs attention'
  if (state === 'processing') return 'Processing'
  if (state === 'running') return 'Running'
  if (state === 'starting') return 'Starting'
  if (state === 'stopped') return 'Stopped'
  return 'Idle'
}

export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

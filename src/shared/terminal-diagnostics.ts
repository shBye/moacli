import { z } from 'zod'

export const diagnosticReason = z.enum([
  'attached', 'disposed', 'sample', 'scroll', 'dom-scroll', 'buffer-change',
  'output-settled', 'input', 'wheel-up', 'wheel-down', 'pointer', 'navigation',
  'erase-display', 'alternate-on', 'alternate-off', 'reset', 'sync-on', 'sync-off',
  'resize-observed', 'resize-fit', 'activate-fit', 'appearance-fit',
  'startup-follow', 'resize-follow', 'resize-restore', 'activate-follow',
  'activate-restore', 'appearance-follow', 'appearance-restore',
  'reveal-frame', 'reveal-timer', 'user-mark', 'attention', 'exit', 'start',
])
export type DiagnosticReason = z.infer<typeof diagnosticReason>
const metric = z.number().finite().min(-1).max(Number.MAX_SAFE_INTEGER)
export const diagnosticPosition = z.object({
  base: metric, viewport: metric, cursor: metric, rows: metric, cols: metric,
  buffer: z.enum(['normal', 'alternate']), active: z.boolean(), focused: z.boolean(),
  scrollTop: metric, scrollHeight: metric, clientHeight: metric,
})
export type DiagnosticPosition = z.infer<typeof diagnosticPosition>
// Whitelist every field at the IPC boundary: never serialize terminal text or arbitrary metadata.
export const diagnosticEventSchema = z.object({
  terminal: z.string().uuid(), agent: z.enum(['codex', 'claude', 'gemini', 'powershell', 'opencode', 'other']),
  reason: diagnosticReason, at: metric, elapsed: metric, sequence: metric,
  position: diagnosticPosition, previous: diagnosticPosition.optional(),
  jump: z.boolean(), outputChars: metric, outputBatches: metric, dropped: metric,
  value: metric.optional(),
})
export type TerminalDiagnosticEvent = z.infer<typeof diagnosticEventSchema>

export function isUpwardJump(before: DiagnosticPosition | undefined, after: DiagnosticPosition): boolean {
  if (!before || !before.active || !after.active) return false
  return before.viewport - after.viewport >= Math.max(3, after.rows)
    || (after.viewport === 0 && before.viewport >= 3)
    || (before.scrollTop - after.scrollTop >= Math.max(40, after.clientHeight) && before.scrollTop > 0)
}

export function diagnosticAgent(agent: string): TerminalDiagnosticEvent['agent'] {
  return ['codex', 'claude', 'gemini', 'powershell', 'opencode'].includes(agent)
    ? agent as TerminalDiagnosticEvent['agent'] : 'other'
}

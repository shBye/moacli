export type NotificationTrace = 'notification-shown' | 'notification-disabled' | 'notification-muted' | 'notification-viewing' | 'notification-state-only' | 'notification-deduplicated' | 'notification-capacity'
export type AttentionStage = NotificationTrace | 'hooks-installed' | 'hooks-unavailable' | 'version-unsupported' | 'osc-received' | 'osc-suppressed' | 'hook-received' | 'hook-ignored' | 'delivered' | 'stale' | 'released'

// Bounded, content-free process-lifetime audit. Exported with terminal diagnostics.
export class AttentionDiagnostics {
  private events: Array<{ at: number; terminal: string; stage: AttentionStage; name?: string }> = []
  private dropped = 0
  constructor(private readonly now: () => number = Date.now) {}
  record(terminal: string, stage: AttentionStage, name?: string): void {
    this.events.push({ at: this.now(), terminal, stage, name })
    if (this.events.length > 500) { this.events.shift(); this.dropped++ }
  }
  snapshot(): object { return { events: this.events.map(event => ({ ...event })), dropped: this.dropped } }
}

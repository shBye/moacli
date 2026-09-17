// Offsets count JavaScript UTF-16 code units at both ends of the MessagePort.
// Cumulative acknowledgements make duplicate/late messages harmless.
export const PTY_OUTPUT_WINDOW = 64 * 1024
export const PTY_OUTPUT_HIGH = 256 * 1024
export const PTY_OUTPUT_LOW = 64 * 1024

export class PtyOutputBuffer {
  private chunks: string[] = []
  private head = 0
  private offset = 0
  private queued = 0
  private sent = 0
  private acknowledged = 0

  get pending(): number { return this.queued }
  get outstanding(): number { return this.sent - this.acknowledged }
  get backlog(): number { return this.queued + this.outstanding }
  get canSend(): boolean { return this.queued > 0 && this.outstanding < PTY_OUTPUT_WINDOW }

  enqueue(data: string): void {
    if (!data) return
    this.chunks.push(data)
    this.queued += data.length
  }

  acknowledge(through: number): void {
    if (!Number.isSafeInteger(through) || through <= this.acknowledged || through > this.sent) return
    this.acknowledged = through
  }

  take(limit: number): { data: string; through: number } | undefined {
    let remaining = Math.min(limit, PTY_OUTPUT_WINDOW - this.outstanding, this.queued)
    if (remaining <= 0) return
    let data = ''
    while (remaining > 0) {
      const chunk = this.chunks[this.head]
      const part = chunk.slice(this.offset, this.offset + remaining)
      data += part
      this.offset += part.length
      remaining -= part.length
      this.queued -= part.length
      if (this.offset === chunk.length) { this.head++; this.offset = 0 }
    }
    if (this.head === this.chunks.length) { this.chunks = []; this.head = 0 }
    else if (this.head > 64) { this.chunks = this.chunks.slice(this.head); this.head = 0 }
    this.sent += data.length
    return { data, through: this.sent }
  }
}

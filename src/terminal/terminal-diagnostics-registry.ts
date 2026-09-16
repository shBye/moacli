// Explicitly scoped live diagnostic adapters. No terminal output is stored here.
const collectors = new Set<() => void>()

export function registerTerminalDiagnostics(markAndFlush: () => void): () => void {
  collectors.add(markAndFlush)
  return () => { collectors.delete(markAndFlush) }
}

export function markAndFlushTerminalDiagnostics(): void {
  for (const markAndFlush of collectors) markAndFlush()
}

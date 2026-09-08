/** Optional CLI metadata: malformed or incomplete lines must not hide history. */
export function parseCodexSessionTitles(text: string): ReadonlyMap<string, string> {
  const titles = new Map<string, string>()
  for (const line of text.split('\n')) {
    try {
      const record = JSON.parse(line)
      if (record && typeof record.id === 'string' && typeof record.thread_name === 'string' && record.thread_name.trim()) {
        titles.set(record.id, record.thread_name.trim())
      }
    } catch { /* An append may still be in progress. */ }
  }
  return titles
}

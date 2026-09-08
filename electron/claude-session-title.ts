export function claudeSessionTitle(records: readonly Record<string, unknown>[]): string {
  let custom = ''
  let generated = ''
  for (const record of records) {
    if (record.type === 'custom-title' && typeof record.customTitle === 'string') custom = record.customTitle.trim()
    if (record.type === 'ai-title' && typeof record.aiTitle === 'string') generated = record.aiTitle.trim()
  }
  return custom || generated
}

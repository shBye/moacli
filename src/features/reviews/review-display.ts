import type { ReviewEntry, ReviewReport } from '../../../electron/review-contracts'

export function parseReviewReport(text: string): ReviewReport | null {
  try {
    const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
    if (!value || typeof value.summary !== 'string' || !Array.isArray(value.findings) || value.findings.length > 100) return null
    if (!value.findings.every((finding: unknown) => {
      if (!finding || typeof finding !== 'object') return false
      const item = finding as Record<string, unknown>
      return ['title', 'location', 'body'].every((key) => typeof item[key] === 'string')
    })) return null
    return { summary: value.summary, findings: value.findings }
  } catch { return null }
}

export function buildRevisionDraft(entry: ReviewEntry, selected: ReadonlySet<number>): string {
  const report = parseReviewReport(entry.result)
  if (!report) return ''
  const findings = report.findings.filter((_, index) => selected.has(index))
  if (!findings.length) return ''
  return [
    `Please assess and address these selected findings and recommendations for "${entry.review.source.title}".`,
    `Review: ${entry.task.id}; snapshot: ${entry.review.snapshot.digest.slice(0, 12)}; base: ${entry.review.snapshot.head}.`,
    'The working tree may have changed since this review. Verify each finding against the current code, preserve unrelated changes, and explain any finding you disagree with. Run appropriate checks after the changes.',
    ...findings.map((finding, index) => `${index + 1}. ${finding.title}\n${finding.location}\n${finding.body}`),
  ].join('\n\n')
}

export function reviewStatusLabel(status: ReviewEntry['task']['status']): string {
  return ({ awaiting_approval: 'Waiting to start', queued: 'Queued', running: 'Working', completed: 'Ready', failed: 'Failed', rejected: 'Declined', cancelled: 'Cancelled' })[status]
}

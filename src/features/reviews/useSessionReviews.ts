import { useCallback, useEffect, useState } from 'react'
import type { CliAgentApi, DelegationSnapshot } from '../../../electron/contracts'
import type { ReviewEntry, ReviewSource } from '../../../electron/review-contracts'
import { sessionTaskRevision } from '../delegation/session-task-display'

export function useSessionReviews(api: CliAgentApi, source: ReviewSource, changes: DelegationSnapshot | null) {
  const [entries, setEntries] = useState<ReviewEntry[]>([])
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  const taskRevision = sessionTaskRevision(changes?.tasks ?? [], source, 'review')
  useEffect(() => {
    let live = true
    void api.listReviews(source).then((next) => {
      if (live) { setEntries(next); setError('') }
    }).catch((reason: unknown) => { if (live) setError(String(reason)) })
    return () => { live = false }
  }, [api, source.sessionId, source.historyKey, taskRevision, revision])
  return { entries, error, refresh }
}

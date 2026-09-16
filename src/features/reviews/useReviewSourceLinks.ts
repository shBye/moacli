import { useEffect, useRef } from 'react'
import type { CliAgentApi, DelegationSnapshot } from '../../../electron/contracts'
import type { RuntimeSession } from '../sessions/types'

// Keep both snapshot and MCP task links even while the Tasks tab is not mounted.
export function useReviewSourceLinks(api: CliAgentApi, sessions: readonly RuntimeSession[], snapshot: DelegationSnapshot | null): void {
  const linked = useRef(new Map<string, string>())
  useEffect(() => {
    const ids = new Set(sessions.map((session) => session.id))
    for (const id of linked.current.keys()) if (!ids.has(id)) linked.current.delete(id)
    for (const session of sessions) {
      if (!session.historyKey) continue
      const unlinkedTasks = snapshot?.tasks.filter((task) =>
        (task.source?.sessionId === session.id && !task.source.historyKey)
        || (task.reviewSource?.sessionId === session.id && !task.reviewSource.historyKey),
      ).map((task) => task.id).sort().join(',') ?? ''
      const signature = JSON.stringify([session.historyKey, session.title, session.cwd, session.terminalRevision, unlinkedTasks])
      if (linked.current.get(session.id) === signature) continue
      const source = { sessionId: session.id, historyKey: session.historyKey, title: session.title, cwd: session.cwd }
      // Reserve before sending, so rerenders cannot duplicate an in-flight request.
      linked.current.set(session.id, signature)
      void api.syncTaskSource(source).catch(() => {
        if (linked.current.get(session.id) === signature) linked.current.delete(session.id)
      })
    }
  }, [api, sessions, snapshot])
}

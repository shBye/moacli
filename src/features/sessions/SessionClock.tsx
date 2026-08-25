import { useEffect, useState } from 'react'
import { formatElapsed } from './session-display'
import type { RuntimeSession } from './types'

interface SessionClockProps {
  session: RuntimeSession
  getLastActivityAt: () => number
}

export function SessionClock({ session, getLastActivityAt }: SessionClockProps) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const activityLabel = session.state === 'processing'
    ? 'processing'
    : session.state === 'needs_attention'
      ? 'waiting for input'
      : 'idle'
  return <span>{activityLabel} {formatElapsed(now - getLastActivityAt())} · closes after 30 min in background</span>
}

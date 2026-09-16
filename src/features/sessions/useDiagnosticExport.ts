import { useEffect, useRef, useState } from 'react'
import { markAndFlushTerminalDiagnostics } from '../../terminal/terminal-diagnostics-registry'

export function useDiagnosticExport(exportLog: () => Promise<boolean>) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const mounted = useRef(true)
  const inFlight = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  return { busy, message, save: async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true); setMessage('')
    try {
      markAndFlushTerminalDiagnostics()
      const saved = await exportLog()
      if (mounted.current) setMessage(saved ? 'Diagnostics saved' : '')
    } catch {
      if (mounted.current) setMessage('Could not save diagnostics. Please retry.')
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  } }
}

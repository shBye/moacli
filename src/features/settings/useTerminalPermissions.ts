import { useEffect, useRef, useState } from 'react'
import type { CliAgentApi } from '../../../electron/contracts'
import type { CodexPermissionMode, TerminalPermissions } from './terminal-permissions'
export type TerminalPermissionApi = Pick<CliAgentApi, 'getTerminalPermissions' | 'setCodexPermissionMode'>
export function useTerminalPermissions(api: TerminalPermissionApi) {
  const [settings, setSettings] = useState<TerminalPermissions | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const live = useRef(false)
  useEffect(() => {
    live.current = true
    let current = true
    void api.getTerminalPermissions().then(value => { if (current) setSettings(value) }, () => { if (current) setError('Could not read permission settings.') })
    return () => { current = false; live.current = false }
  }, [api])
  const save = async (mode: CodexPermissionMode) => {
    setBusy(true); setError('')
    try { const next = await api.setCodexPermissionMode(mode); if (live.current) setSettings(next) }
    catch { if (live.current) setError('Could not save permission settings.') }
    finally { if (live.current) setBusy(false) }
  }
  return { settings, busy, error, save }
}

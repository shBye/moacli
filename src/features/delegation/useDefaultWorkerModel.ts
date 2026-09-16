import { useEffect, useState } from 'react'
import type { AgentAccount } from '../../../electron/contracts'

export function useDefaultWorkerModel(agent: string, account: AgentAccount | undefined,
  read: (agent: string, account?: AgentAccount) => Promise<string>, taskId: string) {
  const [state, setState] = useState({ model: '', loading: true, error: '' })
  useEffect(() => {
    let live = true
    setState({ model: '', loading: true, error: '' })
    void read(agent, account).then(model => {
      if (live) setState({ model, loading: false, error: '' })
    }, () => { if (live) setState({ model: '', loading: false, error: 'Cannot read default model. Choose a specific model or fix CLI settings.' }) })
    return () => { live = false }
  }, [agent, account, read, taskId])
  return state
}

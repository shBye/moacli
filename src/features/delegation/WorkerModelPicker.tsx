import { useEffect, useState } from 'react'
import { SelectBox } from '../../components/SelectBox'
import { modelOptionsWithSaved, presetModelCatalog, type WorkerModelCatalog } from './model-catalog'
import type { AgentAccount } from '../../../electron/contracts'

// IPC stays in this focused boundary hook; the setting and approval forms share the picker.
function useWorkerModelCatalog(agent: string, account?: AgentAccount) {
  const [catalog, setCatalog] = useState<WorkerModelCatalog>(() => presetModelCatalog(agent))
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    let live = true
    setCatalog(presetModelCatalog(agent))
    setLoading(false)
    if (agent !== 'codex') return
    setLoading(true)
    void window.cliAgent.getWorkerModelCatalog(agent, account).then(value => { if (live) setCatalog(value) })
      .catch(() => { if (live) setCatalog({ options: [], note: 'Could not load Codex models. Open/sign in to Codex, then reopen this dialog. CLI default and saved models remain available.' }) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [agent, account?.id, account?.configDir])
  return { catalog, loading }
}

export function WorkerModelPicker({ agent, value, onChange, disabled, account, includeDefault = true }: {
  agent: string; value: string; onChange: (value: string) => void; disabled: boolean; account?: AgentAccount; includeDefault?: boolean
}) {
  const { catalog, loading } = useWorkerModelCatalog(agent, account)
  if (agent === 'opencode') return <input aria-label="OpenCode model ID" value={value} maxLength={160} disabled={disabled}
    placeholder="provider/model (blank: CLI default)" onChange={event => onChange(event.target.value)} />
  const options = modelOptionsWithSaved(catalog.options, value)
  return <div className="worker-model-picker">
    <SelectBox variant="settings" ariaLabel={`${agent} worker model`} value={value} disabled={disabled}
      options={[...(includeDefault ? [{ value: '', label: 'CLI default' }] : []), ...options]} onChange={onChange} />
    <small>{loading ? 'Loading models…' : catalog.note}</small>
  </div>
}

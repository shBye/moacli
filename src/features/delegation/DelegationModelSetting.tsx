import { useEffect, useRef, useState } from 'react'
import { validateModel, workerAgentLabel } from './model-policy'
import { WorkerModelPicker } from './WorkerModelPicker'

export function DelegationModelSetting({ agent, value, disabled, onSave }: {
  agent: string; value: string; disabled: boolean; onSave: (agent: string, model: string) => Promise<void>;
}) {
  const live = useRef(false)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setDraft(value) }, [value])
  const save = async () => {
    try {
      const next = validateModel(draft)
      setBusy(true); setError('')
      await onSave(agent, next)
    } catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : 'Could not save model.') }
    finally { if (live.current) setBusy(false) }
  }
  return <div className="delegation-model-setting">
    <div className="delegation-model-controls">
      <strong>{workerAgentLabel(agent)}</strong>
      <WorkerModelPicker agent={agent} value={draft} disabled={disabled || busy} onChange={setDraft} />
      <button className="secondary-button" disabled={disabled || busy || draft.trim() === value}
        onClick={() => { void save() }}>{busy ? 'Saving...' : 'Save'}</button>
    </div>
    <small>Saved: {value || 'CLI default'}</small>
    {error && <p role="alert" className="delegation-modal-error">{error}</p>}
  </div>
}

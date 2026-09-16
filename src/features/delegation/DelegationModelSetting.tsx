import { useEffect, useRef, useState } from 'react'
import { validateModel } from './model-policy'
import { SelectBox } from '../../components/SelectBox'

export function DelegationModelSetting({ agent, value, disabled, onSave }: {
  agent: string; value: string; disabled: boolean; onSave: (agent: string, model: string) => Promise<void>;
}) {
  const live = useRef(false)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const [custom, setCustom] = useState(Boolean(value))
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setCustom(Boolean(value)); setDraft(value) }, [value])
  const save = async () => {
    try {
      const next = custom ? validateModel(draft) : ''
      if (custom && !next) throw new Error('Enter a model ID.')
      setBusy(true); setError('')
      await onSave(agent, next)
    } catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : 'Could not save model.') }
    finally { if (live.current) setBusy(false) }
  }
  return <div className="delegation-model-setting">
    <div className="delegation-model-controls">
      <strong>{agent === 'claude' ? 'Claude' : 'Codex'}</strong>
      <SelectBox ariaLabel={`${agent} default model mode`} value={custom ? 'custom' : 'cli'}
        options={[{ value: 'cli', label: 'CLI default' }, { value: 'custom', label: 'Specific model' }]}
        disabled={disabled || busy} onChange={value => setCustom(value === 'custom')} />
      {custom && <input aria-label={`${agent} default model ID`} maxLength={160} value={draft}
        placeholder="Model ID" disabled={disabled || busy} onChange={event => setDraft(event.target.value)} />}
      <button className="secondary-button" disabled={disabled || busy || (custom ? draft.trim() === value : value === '')}
        onClick={() => { void save() }}>{busy ? 'Saving...' : 'Save'}</button>
    </div>
    <small>Saved: {value || 'CLI default'}</small>
    {error && <p role="alert" className="delegation-modal-error">{error}</p>}
  </div>
}

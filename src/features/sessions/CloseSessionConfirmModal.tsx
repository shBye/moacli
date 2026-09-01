import { useEffect } from 'react'
import { X } from 'lucide-react'
import type { AgentHealth } from '../../../electron/contracts'
import { AgentAvatar } from '../../components/AgentAvatar'
import type { AgentIconPreference } from '../agent-icons/types'
import type { RuntimeSession } from './types'

interface CloseSessionConfirmModalProps {
  session: RuntimeSession
  profile: AgentHealth | undefined
  iconPreference: AgentIconPreference
  onConfirm: () => void
  onCancel: () => void
}

export function CloseSessionConfirmModal({
  session,
  profile,
  iconPreference,
  onConfirm,
  onCancel,
}: CloseSessionConfirmModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div className="launcher-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel()
    }}>
      <section className="launcher-modal close-session-modal" role="dialog" aria-modal="true" aria-labelledby="close-session-title">
        <button className="icon-button launcher-modal-close" title="Keep the session (Esc)" onClick={onCancel}><X size={15} /></button>
        <header className="close-session-heading">
          <AgentAvatar agentId={session.agentId} className="tinted" color={profile?.color ?? '#7e878d'} preference={iconPreference} />
          <div>
            <h2 id="close-session-title">Close a working session?</h2>
            <p><strong>{session.title}</strong> is still processing — closing it stops the CLI and whatever it is doing.</p>
          </div>
        </header>
        <footer className="close-session-actions">
          <button className="secondary-button" onClick={onCancel}>Keep working</button>
          <button className="modal-danger" autoFocus onClick={onConfirm}>Close session</button>
        </footer>
      </section>
    </div>
  )
}

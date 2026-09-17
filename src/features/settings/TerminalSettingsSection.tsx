import { SelectBox } from '../../components/SelectBox'
import { useTerminalPermissions, type TerminalPermissionApi } from './useTerminalPermissions'
export function TerminalSettingsSection({ api }: { api: TerminalPermissionApi }) {
  const { settings, busy, error, save } = useTerminalPermissions(api)
  return <section className="delegation-settings terminal-settings" aria-label="CLI permissions">
    <div className="delegation-settings-heading"><div>
      <h3>CLI permissions</h3>
      <p>Choose the permissions for new and resumed Codex terminals.</p>
    </div></div>
    <div className="delegation-register-block">
    <div className="terminal-permission-row"><span>Codex</span>
      <SelectBox variant="settings" ariaLabel="Codex permission mode" value={settings?.codex ?? 'cli-default'} disabled={!settings || busy}
        options={[{ value: 'cli-default', label: 'CLI default' }, { value: 'full-access', label: 'Full access (no approvals or sandbox)' }]}
        onChange={value => { if (value === 'cli-default' || value === 'full-access') void save(value) }} />
    </div>
    <p>Full access runs commands without approval prompts or sandbox restrictions.</p>
    <p>Applies the next time a terminal starts or resumes. Delegated workers use their own permissions.</p>
    </div>
    <div className="delegation-register-block">
    <div className="delegation-register-title"><strong>Codex status updates</strong></div>
    <p>Open <em>/hooks</em> in Codex and trust the MoaCLI observer entries to enable approval and completion updates.</p>
    <p>Requires Codex 0.154.0 or newer. Existing hooks are preserved; observers never approve or deny commands.</p>
    <p>Use Save diagnostics to investigate missing updates. Conversation and command content are not recorded.</p>
    </div>
    {busy && <p role="status">Saving...</p>}
    {error && <p role="alert" className="delegation-modal-error">{error}</p>}
  </section>
}

import { SelectBox } from '../../components/SelectBox'
import { useTerminalPermissions, type TerminalPermissionApi } from './useTerminalPermissions'
export function TerminalSettingsSection({ api }: { api: TerminalPermissionApi }) {
  const { settings, busy, error, save } = useTerminalPermissions(api)
  return <section className="delegation-settings" aria-label="CLI permissions">
    <h3>CLI permissions</h3>
    <p>Keep your preferred permissions when starting or resuming a Codex terminal.</p>
    <label>Codex
      <SelectBox ariaLabel="Codex permission mode" value={settings?.codex ?? 'cli-default'} disabled={!settings || busy}
        options={[{ value: 'cli-default', label: 'CLI default' }, { value: 'full-access', label: 'Full access (no approvals or sandbox)' }]}
        onChange={value => { if (value === 'cli-default' || value === 'full-access') void save(value) }} />
    </label>
    <p>Full access lets Codex run commands without approval prompts or sandbox restrictions. Applies to the next new or resumed terminal; running sessions keep their current mode.</p>
    <p>Delegated workers keep their separate analysis and editing permissions.</p>
    <h3>Codex status updates</h3>
    <p>New and resumed Codex terminals install MoaCLI observer hooks alongside your existing hooks. In Codex, open /hooks and trust the MoaCLI observer entries when prompted. These report activity and never approve or deny commands.</p>
    <p>Requires Codex 0.154.0 or newer. Until hooks are trusted, status updates rely on generic terminal notifications. Save diagnostics includes connection events without conversation or command content.</p>
    {busy && <p role="status">Saving...</p>}
    {error && <p role="alert" className="delegation-modal-error">{error}</p>}
  </section>
}

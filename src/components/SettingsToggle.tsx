interface SettingsToggleProps {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}

export function SettingsToggle({ label, checked, disabled = false, onChange }: SettingsToggleProps) {
  return (
    <div className={`settings-toggle-row ${disabled ? 'disabled' : ''}`}>
      <span>{label}</span>
      <button
        className={`settings-toggle ${checked ? 'active' : ''}`}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      ><span /></button>
    </div>
  )
}

interface AppearanceColorProps {
  label: string
  value: string
  onChange: (value: string) => void
}

export function AppearanceColor({ label, value, onChange }: AppearanceColorProps) {
  return (
    <label className="appearance-color">
      <span>{label}</span>
      <span className="appearance-color-value">
        <span className="appearance-color-swatch" style={{ background: value }} />
        <code>{value}</code>
        <input type="color" aria-label={label} value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} />
      </span>
    </label>
  )
}

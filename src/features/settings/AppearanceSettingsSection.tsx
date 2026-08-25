import { RefreshCw, RotateCcw } from 'lucide-react'
import {
  ACCENT_OPTIONS,
  APPEARANCE_PRESETS,
  TERMINAL_FONT_OPTIONS,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  UI_FONT_OPTIONS,
  type AccentTheme,
  type AppearancePreferences,
  type TerminalFontId,
  type TerminalRendererId,
  type UiFontId,
} from '../../appearance'
import { AppearanceColor } from '../../components/AppearanceColor'

interface AppearanceSettingsSectionProps {
  visible: boolean
  theme: AccentTheme
  appearance: AppearancePreferences
  maximumTabs: number
  minimumTabs: number
  maximumTabsLimit: number
  localFonts: readonly string[]
  localFontStatus: string
  onThemeChange: (theme: AccentTheme) => void
  onAppearanceChange: (update: Partial<AppearancePreferences>) => void
  onMaximumTabsChange: (value: number) => void
  onDiscoverLocalFonts: () => void
  onReset: () => void
}

export function AppearanceSettingsSection({
  visible,
  theme,
  appearance,
  maximumTabs,
  minimumTabs,
  maximumTabsLimit,
  localFonts,
  localFontStatus,
  onThemeChange,
  onAppearanceChange,
  onMaximumTabsChange,
  onDiscoverLocalFonts,
  onReset,
}: AppearanceSettingsSectionProps) {
  return (
    <section className="appearance-settings" aria-labelledby="appearance-settings-title" hidden={!visible}>
      <div className="appearance-heading">
        <h3 id="appearance-settings-title">Appearance</h3>
        <button className="appearance-reset" title="Reset appearance" onClick={onReset}><RotateCcw size={13} />Reset</button>
      </div>
      <div className="appearance-row appearance-presets-row">
        <span>Accent</span>
        <div className="theme-segments">
          {ACCENT_OPTIONS.map((option) => (
            <button className={theme === option.id ? 'active' : ''} key={option.id} onClick={() => onThemeChange(option.id)}>
              <span className="theme-swatch" style={{ background: option.color }} />{option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="appearance-row appearance-presets-row">
        <span>Theme</span>
        <div className="appearance-presets">
          {APPEARANCE_PRESETS.map((preset) => (
            <button
              className={theme === preset.accent && Object.entries(preset.colors).every(([key, value]) => appearance[key as keyof typeof preset.colors] === value) ? 'active' : ''}
              key={preset.id}
              onClick={() => {
                onThemeChange(preset.accent)
                onAppearanceChange(preset.colors)
              }}
            >
              <span className="appearance-preset-swatch" style={{ background: `linear-gradient(135deg, ${preset.colors.appBackground} 50%, ${preset.colors.terminalBackground} 50%)` }} />
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <div className="appearance-grid">
        <label className="appearance-field">
          <span>Maximum tabs</span>
          <input
            type="number"
            min={minimumTabs}
            max={maximumTabsLimit}
            step="1"
            value={maximumTabs}
            onChange={(event) => onMaximumTabsChange(Number(event.target.value))}
          />
        </label>
        <label className="appearance-field">
          <span>Interface font</span>
          <select value={appearance.uiFont} onChange={(event) => onAppearanceChange({ uiFont: event.target.value as UiFontId })}>
            {UI_FONT_OPTIONS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className="appearance-field">
          <span>Terminal font</span>
          <select value={appearance.terminalFont} onChange={(event) => onAppearanceChange({ terminalFont: event.target.value as TerminalFontId })}>
            {TERMINAL_FONT_OPTIONS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className="appearance-field">
          <span>Terminal renderer</span>
          <select value={appearance.terminalRenderer} onChange={(event) => onAppearanceChange({ terminalRenderer: event.target.value as TerminalRendererId })}>
            <option value="dom">Standard (best IME stability)</option>
            <option value="webgl">GPU accelerated (WebGL)</option>
          </select>
        </label>
        {appearance.uiFont === 'local' && (
          <label className="appearance-field local-font-field">
            <span>Interface font family</span>
            <input list="installed-font-families" value={appearance.localUiFont} placeholder="Enter an installed font" onChange={(event) => onAppearanceChange({ localUiFont: event.target.value })} />
          </label>
        )}
        {appearance.terminalFont === 'local' && (
          <label className="appearance-field local-font-field">
            <span>Terminal font family</span>
            <input list="installed-font-families" value={appearance.localTerminalFont} placeholder="Enter an installed font" onChange={(event) => onAppearanceChange({ localTerminalFont: event.target.value })} />
          </label>
        )}
        <datalist id="installed-font-families">
          {localFonts.map((family) => <option value={family} key={family} />)}
        </datalist>
      </div>
      <div className="local-font-actions">
        <button onClick={onDiscoverLocalFonts}><RefreshCw size={13} />Load installed fonts</button>
        {localFontStatus && <span>{localFontStatus}</span>}
      </div>
      <label className="terminal-font-size">
        <span>Terminal size</span>
        <input type="range" min={TERMINAL_FONT_SIZE_MIN} max={TERMINAL_FONT_SIZE_MAX} step="1" value={appearance.terminalFontSize} onChange={(event) => onAppearanceChange({ terminalFontSize: Number(event.target.value) })} />
        <output>{appearance.terminalFontSize}px</output>
      </label>
      <div className="appearance-colors">
        <AppearanceColor label="App background" value={appearance.appBackground} onChange={(appBackground) => onAppearanceChange({ appBackground })} />
        <AppearanceColor label="App foreground" value={appearance.appForeground} onChange={(appForeground) => onAppearanceChange({ appForeground })} />
        <AppearanceColor label="Terminal background" value={appearance.terminalBackground} onChange={(terminalBackground) => onAppearanceChange({ terminalBackground })} />
        <AppearanceColor label="Terminal foreground" value={appearance.terminalForeground} onChange={(terminalForeground) => onAppearanceChange({ terminalForeground })} />
      </div>
    </section>
  )
}

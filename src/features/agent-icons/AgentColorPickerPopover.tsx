import type { CSSProperties } from 'react'
import { Check, Palette, RotateCcw } from 'lucide-react'
import { normalizeHexColorDraft, type AgentColorPickerState } from './agent-color'

const AGENT_COLOR_SWATCHES = [
  '#30363D', '#56616B', '#8B949E', '#D8DEE4',
  '#8E3B46', '#C54B5B', '#D86F45', '#B47724',
  '#C49A32', '#6F8A35', '#2F8F67', '#258B86',
  '#3276A8', '#4A68B3', '#6454B2', '#8656A7',
  '#A34F87', '#9B5A45', '#3E6F73', '#5E6673',
]

interface AgentColorPickerPopoverProps {
  picker: AgentColorPickerState
  agentLabel: string
  activeColor: string
  draft: string
  hasCustomColor: boolean
  onClose: () => void
  onReset: () => void
  onDraftChange: (draft: string, completeColor?: string) => void
  onSelect: (color: string) => void
}

export function AgentColorPickerPopover({
  picker,
  agentLabel,
  activeColor,
  draft,
  hasCustomColor,
  onClose,
  onReset,
  onDraftChange,
  onSelect,
}: AgentColorPickerPopoverProps) {
  return (
    <div className="agent-color-popover-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        className="agent-color-popover"
        role="dialog"
        aria-label={`${agentLabel} icon background color`}
        style={{ left: picker.left, top: picker.top }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h3>Background color</h3>
            <p>{agentLabel}</p>
          </div>
          <button className="agent-color-reset" title="Restore the default background color" disabled={!hasCustomColor} onClick={onReset}>
            <RotateCcw size={14} />
          </button>
        </header>
        <div className="agent-color-current">
          <span className="agent-color-preview" style={{ background: activeColor }} />
          <label className="agent-color-hex">
            <span>#</span>
            <input
              value={draft.replace(/^#/, '')}
              maxLength={6}
              spellCheck={false}
              aria-label="HEX color"
              onChange={(event) => {
                const raw = normalizeHexColorDraft(event.target.value)
                onDraftChange(`#${raw}`, raw.length === 6 ? `#${raw}` : undefined)
              }}
            />
          </label>
        </div>
        <div className="agent-color-swatches" aria-label="Recommended colors">
          {AGENT_COLOR_SWATCHES.map((color) => {
            const selected = activeColor.toLocaleLowerCase() === color.toLocaleLowerCase()
            return (
              <button
                className={selected ? 'active' : ''}
                key={color}
                title={color}
                aria-label={color}
                aria-pressed={selected}
                style={{ '--swatch': color } as CSSProperties}
                onClick={() => onSelect(color)}
              >
                {selected && <Check size={13} />}
              </button>
            )
          })}
        </div>
        <footer>
          <label className="agent-color-more">
            <Palette size={14} />
            <span>More colors</span>
            <input type="color" aria-label="Open the full color picker" value={activeColor} onChange={(event) => onSelect(event.target.value)} />
          </label>
          <button className="agent-color-done" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  )
}

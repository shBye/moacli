export interface AgentColorPickerState {
  agentId: string
  left: number
  top: number
}

interface AnchorBounds {
  right: number
  top: number
  bottom: number
}

interface ViewportBounds {
  width: number
  height: number
}

export function calculateColorPickerPosition(
  anchor: AnchorBounds,
  viewport: ViewportBounds,
  popover = { width: 246, height: 350 },
  margin = 12,
): Pick<AgentColorPickerState, 'left' | 'top'> {
  const maximumLeft = Math.max(margin, viewport.width - popover.width - margin)
  const left = Math.min(maximumLeft, Math.max(margin, anchor.right - popover.width))
  const below = anchor.bottom + 8
  const top = below + popover.height <= viewport.height - margin
    ? below
    : Math.max(margin, anchor.top - popover.height - 8)
  return { left, top }
}

export function normalizeHexColorDraft(value: string): string {
  return value.replace(/[^0-9a-f]/gi, '').slice(0, 6).toUpperCase()
}

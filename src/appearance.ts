export type UiFontId = 'inter' | 'system' | 'jetbrains' | 'local'
export type TerminalFontId = 'jetbrains' | 'cascadia' | 'consolas' | 'd2coding' | 'local'
export type TerminalRendererId = 'dom' | 'webgl'
export type AccentTheme =
  | 'amber' | 'periwinkle' | 'mint' | 'coral' | 'sky' | 'rose'
  | 'champagne' | 'bordeaux' | 'jade' | 'copper' | 'ice'

export interface AppearancePreferences {
  uiFont: UiFontId
  localUiFont: string
  terminalFont: TerminalFontId
  localTerminalFont: string
  terminalFontSize: number
  terminalRenderer: TerminalRendererId
  appBackground: string
  appForeground: string
  terminalBackground: string
  terminalForeground: string
}

export const TERMINAL_FONT_SIZE_MIN = 10
export const TERMINAL_FONT_SIZE_MAX = 18

export interface AppearancePreset {
  id: string
  label: string
  accent: AccentTheme
  colors: Pick<AppearancePreferences, 'appBackground' | 'appForeground' | 'terminalBackground' | 'terminalForeground'>
}

export const APPEARANCE_STORAGE_KEY = 'cli-agent-manager.appearance'

export const ACCENT_OPTIONS: Array<{ id: AccentTheme; label: string; color: string; ink: string }> = [
  { id: 'amber', label: 'Amber', color: '#E9B45C', ink: '#1A1409' },
  { id: 'periwinkle', label: 'Periwinkle', color: '#8AA0FF', ink: '#0E1226' },
  { id: 'mint', label: 'Mint', color: '#64D7A5', ink: '#081B14' },
  { id: 'coral', label: 'Coral', color: '#FF8A78', ink: '#25100C' },
  { id: 'sky', label: 'Sky', color: '#66BCE8', ink: '#071923' },
  { id: 'rose', label: 'Rose', color: '#F487B3', ink: '#250D17' },
  { id: 'champagne', label: 'Champagne', color: '#D9C08A', ink: '#1D1608' },
  { id: 'bordeaux', label: 'Bordeaux', color: '#C97786', ink: '#23090F' },
  { id: 'jade', label: 'Jade', color: '#8FC7A9', ink: '#0A1810' },
  { id: 'copper', label: 'Copper', color: '#D28E66', ink: '#200F06' },
  { id: 'ice', label: 'Ice', color: '#A8C6DC', ink: '#0C151D' },
]

export const UI_FONT_OPTIONS: Array<{ id: UiFontId; label: string; family: string }> = [
  { id: 'inter', label: 'Inter', family: "Inter, 'Segoe UI Variable', 'Segoe UI', sans-serif" },
  { id: 'system', label: 'System UI', family: "'Segoe UI Variable', 'Segoe UI', sans-serif" },
  { id: 'jetbrains', label: 'JetBrains Mono', family: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace" },
  { id: 'local', label: 'Local font', family: '' },
]

export const TERMINAL_FONT_OPTIONS: Array<{ id: TerminalFontId; label: string; family: string }> = [
  { id: 'jetbrains', label: 'JetBrains Mono', family: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace" },
  { id: 'cascadia', label: 'Cascadia Mono', family: "'Cascadia Mono', 'Cascadia Code', Consolas, monospace" },
  { id: 'consolas', label: 'Consolas', family: "Consolas, 'Cascadia Mono', monospace" },
  { id: 'd2coding', label: 'D2Coding', family: "D2Coding, 'JetBrains Mono', monospace" },
  { id: 'local', label: 'Local font', family: '' },
]

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  uiFont: 'inter',
  localUiFont: '',
  terminalFont: 'jetbrains',
  localTerminalFont: '',
  terminalFontSize: 12,
  terminalRenderer: 'dom',
  appBackground: '#121418',
  appForeground: '#E7E9EA',
  terminalBackground: '#090A0C',
  terminalForeground: '#C9D0D4',
}

export const APPEARANCE_PRESETS: AppearancePreset[] = [
  { id: 'carbon', label: 'Carbon amber', accent: 'amber', colors: { appBackground: '#121418', appForeground: '#E7E9EA', terminalBackground: '#090A0C', terminalForeground: '#C9D0D4' } },
  { id: 'graphite', label: 'Graphite violet', accent: 'periwinkle', colors: { appBackground: '#1B1D22', appForeground: '#F0F2F3', terminalBackground: '#111318', terminalForeground: '#D5D9DC' } },
  { id: 'deep-black', label: 'Deep black mint', accent: 'mint', colors: { appBackground: '#070809', appForeground: '#E5E7E8', terminalBackground: '#000000', terminalForeground: '#D0D4D7' } },
  { id: 'night-sky', label: 'Night sky', accent: 'sky', colors: { appBackground: '#111820', appForeground: '#E5EDF2', terminalBackground: '#070C11', terminalForeground: '#CAD8E0' } },
  { id: 'charcoal-rose', label: 'Charcoal rose', accent: 'rose', colors: { appBackground: '#181518', appForeground: '#EFE8EC', terminalBackground: '#0C090B', terminalForeground: '#D8CDD3' } },
  { id: 'onyx-gold', label: 'Onyx gold', accent: 'champagne', colors: { appBackground: '#100E0B', appForeground: '#EAE5DA', terminalBackground: '#0A0806', terminalForeground: '#D8D1C2' } },
  { id: 'velvet-bordeaux', label: 'Velvet bordeaux', accent: 'bordeaux', colors: { appBackground: '#161014', appForeground: '#EFE8EB', terminalBackground: '#0C0709', terminalForeground: '#DACFD4' } },
  { id: 'jade-lounge', label: 'Jade lounge', accent: 'jade', colors: { appBackground: '#0F1512', appForeground: '#E6EBE8', terminalBackground: '#080C0A', terminalForeground: '#CDD8D1' } },
  { id: 'espresso-copper', label: 'Espresso copper', accent: 'copper', colors: { appBackground: '#161110', appForeground: '#EDE6E1', terminalBackground: '#0C0908', terminalForeground: '#D9CEC6' } },
  { id: 'platinum-slate', label: 'Platinum slate', accent: 'ice', colors: { appBackground: '#15181C', appForeground: '#ECEFF2', terminalBackground: '#0B0D10', terminalForeground: '#D0D7DD' } },
  { id: 'midnight-indigo', label: 'Midnight indigo', accent: 'periwinkle', colors: { appBackground: '#12141E', appForeground: '#E9EBF4', terminalBackground: '#0A0B13', terminalForeground: '#CFD4E4' } },
]

const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function loadAppearance(): AppearancePreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? '{}') as Partial<AppearancePreferences>
    return {
      uiFont: UI_FONT_OPTIONS.some((option) => option.id === stored.uiFont) ? stored.uiFont! : DEFAULT_APPEARANCE.uiFont,
      localUiFont: validFontName(stored.localUiFont),
      terminalFont: TERMINAL_FONT_OPTIONS.some((option) => option.id === stored.terminalFont) ? stored.terminalFont! : DEFAULT_APPEARANCE.terminalFont,
      localTerminalFont: validFontName(stored.localTerminalFont),
      terminalFontSize: Number.isFinite(stored.terminalFontSize)
        ? Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(stored.terminalFontSize!)))
        : DEFAULT_APPEARANCE.terminalFontSize,
      terminalRenderer: stored.terminalRenderer === 'webgl' ? 'webgl' : DEFAULT_APPEARANCE.terminalRenderer,
      appBackground: validColor(stored.appBackground, DEFAULT_APPEARANCE.appBackground),
      appForeground: validColor(stored.appForeground, DEFAULT_APPEARANCE.appForeground),
      terminalBackground: validColor(stored.terminalBackground, DEFAULT_APPEARANCE.terminalBackground),
      terminalForeground: validColor(stored.terminalForeground, DEFAULT_APPEARANCE.terminalForeground),
    }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

export function saveAppearance(preferences: AppearancePreferences): void {
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preferences))
}

export function uiFontFamily(id: UiFontId, localFont = ''): string {
  if (id === 'local' && localFont) return `${quotedFont(localFont)}, 'Segoe UI', sans-serif`
  return UI_FONT_OPTIONS.find((option) => option.id === id)?.family ?? UI_FONT_OPTIONS[0].family
}

export function terminalFontFamily(id: TerminalFontId, localFont = ''): string {
  if (id === 'local' && localFont) return `${quotedFont(localFont)}, 'JetBrains Mono', Consolas, monospace`
  return TERMINAL_FONT_OPTIONS.find((option) => option.id === id)?.family ?? TERMINAL_FONT_OPTIONS[0].family
}

function validColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toUpperCase() : fallback
}

function validFontName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 120) : ''
}

function quotedFont(value: string): string {
  return `"${value.replace(/["\\]/g, '')}"`
}

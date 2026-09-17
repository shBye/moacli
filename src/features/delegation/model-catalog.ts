import { validateModel } from './model-policy'
export interface WorkerModelOption { value: string; label: string }
export interface WorkerModelCatalog { options: WorkerModelOption[]; note: string }

export function presetModelCatalog(agent: string): WorkerModelCatalog {
  if (agent === 'claude') return { options: ['sonnet', 'opus', 'haiku'].map(value => ({ value, label: `${value[0].toUpperCase()}${value.slice(1)}` })), note: 'CLI aliases · availability depends on your account.' }
  if (agent === 'gemini') return { options: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'].map(value => ({ value, label: value })), note: 'CLI model presets · availability depends on your account and CLI version.' }
  return { options: [], note: agent === 'opencode' ? 'Enter provider/model. Uses your installed OpenCode login.' : 'Models reported by the installed Codex CLI.' }
}

export function parseCodexModels(value: unknown): WorkerModelOption[] {
  if (!Array.isArray(value)) throw new Error('Invalid Codex model list')
  const options: WorkerModelOption[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || entry.hidden === true) continue
    try {
      const model = validateModel(entry.model ?? entry.id)
      if (model && !options.some(option => option.value === model)) options.push({ value: model, label: typeof entry.displayName === 'string' ? entry.displayName.slice(0, 120) : model })
    } catch { /* Ignore malformed entries; never execute catalog data. */ }
  }
  return options
}

export function modelOptionsWithSaved(options: readonly WorkerModelOption[], saved: string): WorkerModelOption[] {
  return saved && !options.some(option => option.value === saved) ? [...options, { value: saved, label: `${saved} (saved)` }] : [...options]
}

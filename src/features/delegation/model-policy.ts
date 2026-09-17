export const WORKER_AGENTS = ['claude', 'codex', 'gemini', 'opencode'] as const
export type WorkerModelAgent = typeof WORKER_AGENTS[number]
export function isWorkerAgent(value: string): value is WorkerModelAgent {
  return (WORKER_AGENTS as readonly string[]).includes(value)
}
export function workerAgentLabel(value: string): string {
  return ({ claude: 'Claude', codex: 'Codex', gemini: 'Gemini', opencode: 'OpenCode' } as Record<string, string>)[value] ?? value
}
export type DelegationModels = Record<WorkerModelAgent, string>

export function validateModel(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Model must be a string')
  const model = value.trim()
  if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/\[\]-]{0,159}$/.test(model)) {
    throw new Error('Enter a model ID without spaces or shell characters (up to 160 characters).')
  }
  return model
}

export function parseDelegationModels(value: unknown): DelegationModels {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const read = (agent: WorkerModelAgent) => { try { return validateModel(record[agent] ?? '') } catch { return '' } }
  return { claude: read('claude'), codex: read('codex'), gemini: read('gemini'), opencode: read('opencode') }
}

export function workerModelArgs(model?: string): string[] {
  const validated = validateModel(model ?? '')
  return validated ? ['--model', validated] : []
}

export const CODEX_OBSERVER_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'PostToolUse', 'Stop', 'Interrupt'] as const

// Append to a separate hooks.json layer: never replace config.toml hooks or notify.
export function mergeCodexObserverHooks(input: unknown, command: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid hooks file')
  const root = input as Record<string, unknown>
  if (root.hooks !== undefined && (!root.hooks || typeof root.hooks !== 'object' || Array.isArray(root.hooks))) throw new Error('Invalid hooks map')
  const hooks = { ...root.hooks as Record<string, unknown> | undefined }
  for (const name of CODEX_OBSERVER_EVENTS) {
    const groups = hooks[name] ?? []
    if (!Array.isArray(groups)) throw new Error('Invalid hook groups')
    const exists = groups.some(group => group && Array.isArray(group.hooks)
      && group.hooks.some((handler: Record<string, unknown>) => handler?.type === 'command' && handler.command === command))
    hooks[name] = exists ? [...groups] : [...groups, { hooks: [{ type: 'command', command, timeout: 3 }] }]
  }
  return { ...root, hooks }
}

export function reviewWorkerArgs(agent: 'claude' | 'codex'): string[] {
  if (agent === 'claude') return ['--tools', '', '--disallowedTools', 'Agent,Task', '--disable-slash-commands', '--setting-sources', 'user', '--settings', '{"disableAllHooks":true}', '--permission-mode', 'plan']
  return ['-c', 'features.shell_tool=false',
    '-c', 'features.unified_exec=false',
  ]
}

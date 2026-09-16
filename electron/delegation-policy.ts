import { isAbsolute, relative, resolve } from 'node:path'

export type DelegationMode = 'analyze' | 'edit'
export const MAX_OPEN_TASKS = 10
export const MAX_RUNNING_TASKS = 3
export const MAX_DELEGATION_DEPTH = 1

export function shouldAutoApproveTask(task: { mode?: DelegationMode; retryOfId?: string; reviewSource?: unknown }, settings: { autoApprove: boolean; autoApproveEdits: boolean }): boolean {
  if (task.retryOfId || task.reviewSource) return false
  return task.mode === 'edit' ? settings.autoApproveEdits : settings.autoApprove
}

export function assertRootCaller(depth: unknown = 0): void {
  if (depth !== 0) throw new Error('Mini agents cannot delegate. Return the result or ask the original CLI for follow-up work.')
}

export function overlappingWorkspaces(left: string, right: string): boolean {
  const normalize = (value: string) => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value)
  const a = normalize(left), b = normalize(right)
  const contains = (parent: string, child: string) => {
    const path = relative(parent, child)
    return !path || (!isAbsolute(path) && path !== '..' && !path.startsWith('..\\') && !path.startsWith('../'))
  }
  return contains(a, b) || contains(b, a)
}

export function canStartDelegation(candidate: { mode: DelegationMode; cwd: string }, running: readonly { mode: DelegationMode; cwd: string }[]): boolean {
  if (running.length >= MAX_RUNNING_TASKS) return false
  return candidate.mode !== 'edit' || !running.some((task) => task.mode === 'edit' && overlappingWorkspaces(candidate.cwd, task.cwd))
}

export function singleLevelPrompt(prompt: string, mode: DelegationMode): string {
  return [
    'You are a single-level MoaCLI worker. Complete only this task; never spawn agents, delegate, or launch another coding CLI, including through shell commands.',
    'If more work or context is needed, return it to the original CLI. Keep the result concise: outcome, evidence/changed files, checks, and unresolved items. Do not repeat the input.',
    mode === 'edit' ? 'Edit only what the task requests. Preserve unrelated changes. The original CLI owns integration and final verification.' : 'Analyze only. Do not change project files. Return concrete findings or a plan.',
    prompt,
  ].join('\n\n')
}

export function delegatedWorkerArgs(agent: 'claude' | 'codex', mode: DelegationMode): string[] {
  if (agent === 'claude') return [
    '--disable-slash-commands', '--setting-sources', 'user', '--settings', '{"disableAllHooks":true}',
    '--permission-mode', mode === 'edit' ? 'acceptEdits' : 'plan',
    '--disallowedTools', mode === 'edit' ? 'Agent,Task' : 'Agent,Task,Edit,Write',
  ]
  return ['--ignore-user-config', '--ignore-rules', '--sandbox', mode === 'edit' ? 'workspace-write' : 'read-only',
    '-c', 'approval_policy="never"', '-c', 'features.multi_agent=false', '-c', 'features.multi_agent_v2=false',
    '-c', 'features.apps=false', '-c', 'features.plugins=false', '-c', 'features.remote_plugin=false',
    '-c', 'features.skill_search=false', '-c', 'features.skill_mcp_dependency_install=false',
    '-c', 'web_search="disabled"', '-c', 'mcp_servers={}']
}

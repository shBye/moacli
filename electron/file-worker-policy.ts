import type { DelegationMode } from './delegation-policy'

export function geminiWorkerSettings(mode: DelegationMode, reviewOnly: boolean) {
  const tools = reviewOnly ? [] : ['list_directory', 'read_file', 'read_many_files', 'glob', 'grep_search',
    ...(mode === 'edit' ? ['replace', 'write_file'] : [])]
  return {
    tools: { core: tools, allowed: tools, discoveryCommand: '', callCommand: '' },
    admin: { mcp: { enabled: false }, extensions: { enabled: false }, skills: { enabled: false } },
    hooksConfig: { enabled: false }, skills: { enabled: false },
    ...(reviewOnly ? { context: { fileName: 'MOACLI_SNAPSHOT_NO_CONTEXT.md', includeDirectoryTree: false } } : {}),
    agents: { overrides: {} },
    general: { enableAutoUpdate: false },
  }
}

export function openCodeWorkerSettings(mode: DelegationMode, reviewOnly: boolean) {
  const permission = {
    '*': 'deny',
    ...(!reviewOnly ? { read: 'allow', glob: 'allow', grep: 'allow', list: 'allow',
      ...(mode === 'edit' ? { edit: 'allow' } : {}) } : {}),
    external_directory: 'deny',
  }
  return {
    $schema: 'https://opencode.ai/config.json',
    share: 'disabled', autoupdate: false, permission, plugin: [], mcp: {},
    agent: { 'moacli-worker': { description: 'MoaCLI file worker', mode: 'primary', permission, steps: 30 } },
  }
}

export function assertFileWorkerVersion(agent: 'gemini' | 'opencode', version: string): void {
  const parts = version.match(/\b(\d+)\.(\d+)\.(\d+)\b/)
  if (!parts) throw new Error(`Cannot verify ${agent} version. Update the CLI and try again.`)
  const [major, minor, patch] = parts.slice(1).map(Number)
  const supported = agent === 'gemini' ? major === 0 && minor >= 56
    : major === 1 && (minor > 2 || (minor === 2 && patch >= 27))
  if (!supported) throw new Error(`${agent} worker requires ${agent === 'gemini' ? 'Gemini 0.56.x or newer 0.x' : 'OpenCode 1.2.27 or newer 1.x'}. This version's worker policy is not supported.`)
}

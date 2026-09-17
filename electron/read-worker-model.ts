import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'smol-toml'
import type { AgentAccount } from './contracts'
import { validateModel, type WorkerModelAgent } from '../src/features/delegation/model-policy'

function readOptional(path: string): string | undefined {
  try { return readFileSync(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error('Cannot read the CLI model setting. Choose an explicit delegation model or fix the CLI configuration.')
  }
}

export function configuredCodexModel(config: Record<string, unknown>, profile?: Record<string, unknown>): string {
  const legacyProfiles = config.profiles as Record<string, Record<string, unknown>> | undefined
  const legacy = typeof config.profile === 'string' ? legacyProfiles?.[config.profile] : undefined
  return validateModel(profile?.model ?? legacy?.model ?? config.model ?? '')
}

// Read only model selection; never copy CLI permissions, hooks or transports into a worker.
export function readWorkerModel(agent: WorkerModelAgent, selected: string, account?: AgentAccount,
  env: NodeJS.ProcessEnv = process.env, home: string = homedir(), read = readOptional): string {
  if (selected) return validateModel(selected)
  const customHome = account?.configDir && !account.detected ? account.configDir : undefined
  try {
    // These CLIs resolve their own native defaults; don't interpret another CLI's config.
    if (agent === 'gemini' || agent === 'opencode') return ''
    if (agent === 'claude') {
      if (env.ANTHROPIC_MODEL) return validateModel(env.ANTHROPIC_MODEL)
      const text = read(join(customHome || env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'settings.json'))
      const model = text ? (JSON.parse(text) as { model?: unknown }).model : undefined
      // Leave organization/default alias resolution to Claude when not explicitly configured.
      return validateModel(model ?? '')
    }
    const directory = customHome || env.CODEX_HOME || join(home, '.codex')
    const text = read(join(directory, 'config.toml'))
    if (!text) return ''
    const config = parse(text)
    let profile: Record<string, unknown> | undefined
    if (typeof config.profile === 'string') {
      if (!/^[a-zA-Z0-9_-]+$/.test(config.profile)) throw new Error('Invalid profile name')
      const profileText = read(join(directory, `${config.profile}.config.toml`))
      if (profileText) profile = parse(profileText)
    }
    return configuredCodexModel(config, profile)
  } catch {
    throw new Error('Cannot resolve the CLI model setting. Choose an explicit delegation model or fix the CLI configuration.')
  }
}

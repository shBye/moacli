import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'
import defaultProfiles from '../profiles/agents.default.json'
import type { AgentAttentionSupport, AgentHealth, AgentProfile } from './contracts'

const execFileAsync = promisify(execFile)

function parseProfile(profile: (typeof defaultProfiles)[number]): AgentProfile {
  const attentionAdapter = profile.attention_adapter
  let parsedAttentionAdapter: AgentProfile['attention_adapter']
  if (attentionAdapter === 'claude-http' || attentionAdapter === 'codex-osc9') {
    parsedAttentionAdapter = attentionAdapter
  } else if (attentionAdapter) {
    throw new Error(`Unknown attention adapter: ${attentionAdapter}`)
  }
  return { ...profile, attention_adapter: parsedAttentionAdapter }
}

const profiles = defaultProfiles.map(parseProfile)

function executableNames(bin: string): string[] {
  if (process.platform !== 'win32' || /\.(?:exe|cmd|bat|ps1)$/i.test(bin)) return [bin]
  return [`${bin}.cmd`, `${bin}.exe`, `${bin}.bat`, `${bin}.ps1`, bin]
}

export function executableCommand(executable: string, args: string[]): { file: string; args: string[]; shell: boolean } {
  if (process.platform === 'win32' && /\.ps1$/i.test(executable)) {
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', executable, ...args],
      shell: false,
    }
  }
  return {
    file: executable,
    args,
    shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable),
  }
}

export function detectBinary(bin: string): string | null {
  if (existsSync(bin)) return bin

  const pathEntries = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  if (process.platform === 'win32' && process.env.APPDATA) {
    pathEntries.unshift(join(process.env.APPDATA, 'npm'))
  }

  for (const directory of [...new Set(pathEntries)]) {
    for (const name of executableNames(bin)) {
      const candidate = join(directory, name)
      if (existsSync(candidate)) return candidate
    }
  }

  if (process.platform === 'win32' && bin.toLocaleLowerCase() === 'codex') {
    const packageArch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const targetArch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
    const bundledCandidates = [
      join(
        process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
        'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai',
        `codex-win32-${packageArch}`, 'vendor', `${targetArch}-pc-windows-msvc`, 'bin', 'codex.exe',
      ),
      join(homedir(), '.codex', '.sandbox-bin', 'codex.exe'),
      join(homedir(), '.codex', 'plugins', '.plugin-appserver', 'codex.exe'),
    ]
    for (const candidate of bundledCandidates) {
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

export async function getVersion(profile: AgentProfile, resolvedPath: string): Promise<string | null> {
  try {
    const command = executableCommand(resolvedPath, profile.version_cmd)
    const { stdout, stderr } = await execFileAsync(command.file, command.args, {
      windowsHide: true,
      shell: command.shell,
      timeout: 5000,
      env: { ...process.env, ...profile.env },
    })
    return `${stdout}${stderr}`.trim().split(/\r?\n/, 1)[0] || null
  } catch {
    return null
  }
}

export function parseSemanticVersion(value: string | null): number[] | null {
  const match = value?.match(/\b(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?\b/)
  return match ? match.slice(1, 4).map(Number) : null
}

export function isVersionAtLeast(value: string | null, minimum: string): boolean {
  const currentParts = parseSemanticVersion(value)
  const minimumParts = parseSemanticVersion(minimum)
  if (!currentParts || !minimumParts) return false
  for (let index = 0; index < 3; index += 1) {
    if (currentParts[index] !== minimumParts[index]) return currentParts[index] > minimumParts[index]
  }
  return true
}

export function getAttentionSupport(
  profile: AgentProfile,
  available: boolean,
  version: string | null,
): AgentAttentionSupport {
  if (!profile.attention_adapter || !profile.attention_min_version) {
    return { status: 'not_integrated', minimumVersion: null }
  }
  if (!available || !version) {
    return { status: 'version_unknown', minimumVersion: profile.attention_min_version }
  }
  return {
    status: isVersionAtLeast(version, profile.attention_min_version) ? 'supported' : 'update_required',
    minimumVersion: profile.attention_min_version,
  }
}

export function getProfile(agentId: string): AgentProfile | undefined {
  return profiles.find((profile) => profile.id === agentId)
}

export async function getAgentHealth(): Promise<AgentHealth[]> {
  return Promise.all(profiles.map(async (profile) => {
    const resolvedPath = detectBinary(profile.bin)
    const version = resolvedPath ? await getVersion(profile, resolvedPath) : null
    const available = Boolean(resolvedPath)
    return {
      ...profile,
      available,
      resolvedPath,
      version,
      attention: getAttentionSupport(profile, available, version),
    }
  }))
}

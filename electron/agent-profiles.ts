import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'
import defaultProfiles from '../profiles/agents.default.json'
import type { AgentHealth, AgentProfile } from './contracts'

const execFileAsync = promisify(execFile)
const profiles = defaultProfiles satisfies AgentProfile[]

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

async function getVersion(profile: AgentProfile, resolvedPath: string): Promise<string | null> {
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

export function getProfile(agentId: string): AgentProfile | undefined {
  return profiles.find((profile) => profile.id === agentId)
}

export async function getAgentHealth(): Promise<AgentHealth[]> {
  return Promise.all(profiles.map(async (profile) => {
    const resolvedPath = detectBinary(profile.bin)
    const version = resolvedPath ? await getVersion(profile, resolvedPath) : null
    return {
      ...profile,
      available: Boolean(resolvedPath),
      resolvedPath,
      version,
    }
  }))
}

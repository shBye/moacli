import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Remote/managed configuration can override a worker's tool policy or load plugins.
// Refuse those configurations rather than modifying native credentials or weakening policy.
export function checkOpenCodeWorkerConfig(env: NodeJS.ProcessEnv = process.env, home = homedir()): void {
  const managed = env.OPENCODE_TEST_MANAGED_CONFIG_DIR || (process.platform === 'win32'
    ? join(env.ProgramData || 'C:\\ProgramData', 'opencode')
    : process.platform === 'darwin' ? '/Library/Application Support/opencode' : '/etc/opencode')
  if (['opencode.json', 'opencode.jsonc'].some(file => existsSync(join(managed, file)))) {
    throw new Error('OpenCode workers cannot verify managed configuration. Use a Claude/Codex worker for this task.')
  }
  const authPath = join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'opencode', 'auth.json')
  if (!existsSync(authPath)) return
  let auth: Record<string, unknown>
  try { auth = JSON.parse(readFileSync(authPath, 'utf8')) } catch { throw new Error('Cannot verify OpenCode login configuration.') }
  if (!auth || typeof auth !== 'object') throw new Error('Cannot verify OpenCode login configuration.')
  if (Object.values(auth).some(value => value && typeof value === 'object' && (value as { type?: unknown }).type === 'wellknown')) {
    throw new Error('OpenCode remote organization configuration is not supported by file workers. Use a Claude/Codex worker for this task.')
  }
}

import { spawn, execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { detectBinary, executableCommand } from './agent-profiles'
import type { AgentAccount } from './contracts'
import { parseCodexModels, presetModelCatalog, type WorkerModelCatalog, type WorkerModelOption } from '../src/features/delegation/model-catalog'

export async function readWorkerModelCatalog(agent: string, account?: AgentAccount): Promise<WorkerModelCatalog> {
  if (agent !== 'codex') return presetModelCatalog(agent)
  const binary = detectBinary('codex')
  if (!binary) throw new Error('Install Codex to load its model list. CLI default remains available.')
  const command = executableCommand(binary, ['app-server'])
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, { cwd: homedir(), shell: command.shell, windowsHide: true,
      env: { ...process.env, ...(account?.configDir && !account.detected ? { CODEX_HOME: account.configDir } : {}) }, stdio: ['pipe', 'pipe', 'pipe'] })
    let pending = '', settled = false, requestId = 1, pages = 0
    const models: WorkerModelOption[] = []
    const finish = (error?: string) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      child.stdin.end()
      if (process.platform === 'win32' && child.pid) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
      else child.kill()
      if (error) reject(new Error(error))
      else resolve({ options: models, note: 'Models reported by your Codex CLI.' })
    }
    const timer = setTimeout(() => finish('Codex model lookup timed out. CLI default remains available.'), 12_000)
    const send = (message: unknown) => { if (!settled) child.stdin.write(`${JSON.stringify(message)}\n`) }
    child.stdin.on('error', () => finish('Codex model connection closed.'))
    child.stderr.resume()
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (text: string) => {
      pending += text
      if (pending.length > 2_000_000) return finish('Codex model response is too large.')
      let newline: number
      while (!settled && (newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
        let message
        try { message = JSON.parse(line) } catch { continue }
        if (!message || message.id !== requestId) continue
        if (message.error) return finish('Codex could not provide its model list. Update or sign in to the CLI.')
        if (requestId === 1) {
          send({ method: 'initialized', params: {} })
          send({ id: ++requestId, method: 'model/list', params: { limit: 100, includeHidden: false } })
        } else {
          try { models.push(...parseCodexModels(message.result?.data)) } catch { return finish('Invalid Codex model response.') }
          const cursor = message.result?.nextCursor
          if (typeof cursor === 'string' && cursor && ++pages < 10) send({ id: ++requestId, method: 'model/list', params: { cursor, limit: 100, includeHidden: false } })
          else finish()
        }
      }
    })
    child.on('error', () => finish('Could not start Codex model lookup.'))
    child.on('close', () => finish('Codex exited before returning its model list.'))
    send({ id: requestId, method: 'initialize', params: { clientInfo: { name: 'moacli_model_picker', version: '1.0.0' }, capabilities: {} } })
  })
}

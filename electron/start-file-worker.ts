import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectBinary } from './agent-profiles'
import { runWorkerProcess } from './run-worker-process'
import { assertFileWorkerVersion, geminiWorkerSettings, openCodeWorkerSettings } from './file-worker-policy'
import { decodeFileWorkerEvent, type FileWorkerState } from './file-worker-events'
import { workerModelArgs } from '../src/features/delegation/model-policy'
import type { WorkerStart, WorkerHandle } from './delegation-workers'
import { checkOpenCodeWorkerConfig } from './check-opencode-worker-config'

// One child at a time, including the version probe, so cancellation owns the entire lifecycle.
export function startFileWorker(start: WorkerStart): WorkerHandle {
  const agent = start.agent
  if (agent !== 'gemini' && agent !== 'opencode') throw new Error('Unsupported file worker')
  const binary = detectBinary(agent)
  if (!binary) throw new Error(`${agent} CLI was not found on this machine`)
  let cancelled = false
  let cancelChild = () => {}
  const startedAt = Date.now()
  const done = (async () => {
    if (agent === 'opencode') checkOpenCodeWorkerConfig()
    const probe = runWorkerProcess(binary, ['--version'], { ...start, prompt: '', timeoutMs: Math.min(start.timeoutMs, 15_000) }, () => {})
    cancelChild = probe.cancel
    const version = await probe.outcome
    if (cancelled || version.cancelled) throw new Error(`${agent} worker was cancelled`)
    if (version.timedOut || version.exitCode !== 0) throw new Error(`Could not check ${agent} version. Run ${agent} --version in a terminal first.`)
    assertFileWorkerVersion(agent, version.stdout)
    const directory = mkdtempSync(join(tmpdir(), 'moacli-file-worker-'))
    const configPath = join(directory, 'settings.json')
    const configDirectory = join(directory, 'opencode')
    const mode = start.mode ?? 'analyze'
    const reviewOnly = Boolean(start.reviewOnly)
    let state: FileWorkerState = { text: '', completed: false }
    try {
      const environment: NodeJS.ProcessEnv = {}
      let args: string[]
      if (agent === 'gemini') {
        writeFileSync(configPath, JSON.stringify(geminiWorkerSettings(mode, reviewOnly)), 'utf8')
        environment.GEMINI_CLI_SYSTEM_SETTINGS_PATH = configPath
        args = ['--output-format', 'stream-json', '--approval-mode', mode === 'edit' && !reviewOnly ? 'auto_edit' : 'default', ...workerModelArgs(start.model)]
      } else {
        mkdirSync(configDirectory)
        environment.XDG_CONFIG_HOME = directory
        environment.OPENCODE_CONFIG_DIR = configDirectory
        environment.OPENCODE_CONFIG = ''
        environment.OPENCODE_CONFIG_CONTENT = JSON.stringify(openCodeWorkerSettings(mode, reviewOnly))
        environment.OPENCODE_PERMISSION = ''
        environment.OPENCODE_DISABLE_PROJECT_CONFIG = '1'
        environment.OPENCODE_DISABLE_EXTERNAL_SKILLS = '1'
        environment.OPENCODE_DISABLE_AUTOUPDATE = '1'
        environment.OPENCODE_AUTO_SHARE = '0'
        args = ['run', '--format', 'json', '--agent', 'moacli-worker', ...workerModelArgs(start.model)]
      }
      const remaining = start.timeoutMs - (Date.now() - startedAt)
      if (cancelled) throw new Error(`${agent} worker was cancelled`)
      if (remaining <= 0) throw new Error(`${agent} worker timed out`)
      const process = runWorkerProcess(binary, args, { ...start, cwd: reviewOnly ? directory : start.cwd, timeoutMs: remaining }, line => {
        let event: Record<string, unknown>
        try { event = JSON.parse(line) } catch { return }
        if (!event || typeof event !== 'object') return
        const update = decodeFileWorkerEvent(agent, state, event)
        if (update.state.sessionId && update.state.sessionId !== state.sessionId) start.onSessionId?.(update.state.sessionId)
        state = update.state
        if (update.progress) start.onProgress(update.progress.replace(/\s+/g, ' ').slice(0, 240))
      }, environment)
      cancelChild = process.cancel
      const result = await process.outcome
      if (cancelled || result.cancelled) throw new Error(`${agent} worker was cancelled`)
      if (result.timedOut) throw new Error(`${agent} worker timed out`)
      if (result.exitCode !== 0) throw new Error(`${agent} exited with code ${result.exitCode}: ${result.stderr.slice(-2000)}`)
      if (state.error) throw new Error(state.error)
      if (!state.completed || !state.text.trim()) throw new Error(`${agent} finished without a successful final answer`)
      return { text: state.text, detail: `${agent}; ${reviewOnly ? 'snapshot only' : mode === 'edit' ? 'file editing' : 'read/search only'}; shell and delegation disabled` }
    } finally {
      // Delete only the configuration we wrote. CLI-created files are never recursively removed.
      try { unlinkSync(configPath) } catch { /* absent */ }
      try { rmdirSync(configDirectory) } catch { /* absent or CLI-owned files remain */ }
      try { rmdirSync(directory) } catch { /* preserve CLI-owned files */ }
    }
  })()
  return { done, cancel: () => { cancelled = true; cancelChild() } }
}

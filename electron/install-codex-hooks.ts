import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { StartPtyRequest } from './contracts'
import { mergeCodexObserverHooks } from './codex-hook-policy'
import relaySource from './codex-hook-relay.cjs?raw'

function writeChanged(path: string, contents: string): void {
  if (existsSync(path) && readFileSync(path, 'utf8') === contents) return
  writeFileSync(path, contents, 'utf8')
}

export function installCodexHooks(request: StartPtyRequest, directory: string): void {
  mkdirSync(directory, { recursive: true })
  const windows = process.platform === 'win32'
  const wrapper = join(directory, windows ? 'observe.cmd' : 'observe.sh')
  // Wrapper affects only the relay subprocess, never the CLI's environment.
  writeChanged(join(directory, 'relay.cjs'), relaySource)
  writeChanged(wrapper, windows
    ? '@echo off\r\nsetlocal\r\nif not defined MOACLI_CODEX_HOOK_ENDPOINT exit /b 0\r\nif not defined MOACLI_HOOK_EXECUTABLE exit /b 0\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%MOACLI_HOOK_EXECUTABLE%" "%~dp0relay.cjs"\r\nexit /b 0\r\n'
    : '#!/bin/sh\n[ -n "$MOACLI_CODEX_HOOK_ENDPOINT" ] || exit 0\n[ -n "$MOACLI_HOOK_EXECUTABLE" ] || exit 0\nELECTRON_RUN_AS_NODE=1 "$MOACLI_HOOK_EXECUTABLE" "$(dirname "$0")/relay.cjs"\nexit 0\n')
  if (/["\r\n%]/.test(wrapper)) throw new Error('Unsupported hook path')
  const command = windows ? `cmd.exe /d /c call "${wrapper}"` : `sh '${wrapper.replaceAll("'", "'\\''")}'`
  const home = request.account?.configDir && !request.account.detected
    ? request.account.configDir : process.env.CODEX_HOME || join(homedir(), '.codex')
  mkdirSync(home, { recursive: true })
  const path = join(home, 'hooks.json')
  const original = existsSync(path) ? readFileSync(path, 'utf8') : undefined
  const input: unknown = original === undefined ? {} : JSON.parse(original.replace(/^\uFEFF/, ''))
  const merged = mergeCodexObserverHooks(input, command)
  if (JSON.stringify(input) === JSON.stringify(merged)) return
  const temporary = `${path}.moacli-${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(merged, null, 2) + '\n', { flag: 'wx' })
    const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined
    if (current !== original) throw new Error('Hooks changed during installation')
    if (original !== undefined) writeFileSync(`${path}.moacli-backup-${randomUUID()}`, original, { flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseTerminalPermissions, type CodexPermissionMode, type TerminalPermissions } from '../src/features/settings/terminal-permissions'

export class TerminalPermissionStore {
  constructor(private readonly path: string) {}
  read(): TerminalPermissions {
    try { return parseTerminalPermissions(JSON.parse(readFileSync(this.path, 'utf8'))) }
    catch { return { codex: 'cli-default' } }
  }
  save(codex: CodexPermissionMode): TerminalPermissions {
    if (codex !== 'cli-default' && codex !== 'full-access') throw new Error('Invalid Codex permission mode')
    const next = { codex }
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path + '.tmp', JSON.stringify(next, null, 2), 'utf8')
    renameSync(this.path + '.tmp', this.path)
    return next
  }
}

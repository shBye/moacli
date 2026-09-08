import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseCodexSessionTitles } from './codex-session-titles'

/** Owns the optional title-index cache; each history service gets its own reader. */
export class CodexSessionTitleReader {
  private readonly cache = new Map<string, { stamp: string; titles: ReadonlyMap<string, string> }>()

  read(configDir: string): ReadonlyMap<string, string> {
    const path = join(configDir, 'session_index.jsonl')
    try {
      const stat = statSync(path)
      const stamp = `${stat.mtimeMs}:${stat.size}`
      const cached = this.cache.get(path)
      if (cached?.stamp === stamp) return cached.titles
      const titles = parseCodexSessionTitles(readFileSync(path, 'utf8'))
      this.cache.set(path, { stamp, titles })
      return titles
    } catch {
      this.cache.delete(path)
      return new Map()
    }
  }
}

import type { HistorySession } from '../../../electron/contracts'
import type { RuntimeSession } from './types'

export type TitleMode = 'auto' | 'custom'
export type CustomTitles = Readonly<Record<string, string>>

export function initialSessionTitle(mode: TitleMode, input: string, fallback: string): Pick<RuntimeSession, 'title' | 'customTitle'> {
  const customTitle = mode === 'custom' ? input.trim().slice(0, 40) || undefined : undefined
  return { title: customTitle || fallback, customTitle }
}

export function resumedSessionTitle(session: HistorySession, titles: CustomTitles): Pick<RuntimeSession, 'title' | 'customTitle'> {
  return { title: resolveHistoryTitle(session, titles), customTitle: Object.hasOwn(titles, session.key) ? titles[session.key] : undefined }
}

export function parseCustomTitles(raw: string | null): CustomTitles {
  try {
    const value: unknown = JSON.parse(raw ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([key, title]) => (
      key.length > 0 && typeof title === 'string' && title.trim().length > 0 && title.length <= 40
    )))
  } catch { return {} }
}

export function collectCustomTitles(current: CustomTitles, sessions: readonly RuntimeSession[]): CustomTitles {
  const entries = sessions.filter((session) => session.historyKey && session.customTitle
    && current[session.historyKey] !== session.customTitle)
  return entries.length ? { ...current, ...Object.fromEntries(entries.map((session) => [session.historyKey, session.customTitle!])) } : current
}

export function resolveHistoryTitle(session: HistorySession, titles: CustomTitles): string {
  return Object.hasOwn(titles, session.key) ? titles[session.key] : session.title
}

export function syncSessionTitles(sessions: RuntimeSession[], history: readonly HistorySession[], titles: CustomTitles): RuntimeSession[] {
  const byKey = new Map(history.map((item) => [item.key, item]))
  let changed = false
  const next = sessions.map((session) => {
    const item = byKey.get(session.historyKey)
    const title = session.customTitle || (item ? resolveHistoryTitle(item, titles) : session.title)
    if (title === session.title) return session
    changed = true
    return { ...session, title }
  })
  return changed ? next : sessions
}

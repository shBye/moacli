import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { ConversationSearchResult, HistorySession } from '../../../electron/contracts'
import type { RuntimeSession } from './types'
import { collectCustomTitles, parseCustomTitles, resolveHistoryTitle, syncSessionTitles } from './session-title'

const STORAGE_KEY = 'cli-agent-manager.custom-session-titles'
type TitleStorage = Pick<Storage, 'getItem' | 'setItem'>

export function useSessionTitles(rawHistory: HistorySession[], rawSearchResults: ConversationSearchResult[], sessions: RuntimeSession[], setSessions: Dispatch<SetStateAction<RuntimeSession[]>>, storage: TitleStorage) {
  const [saved, setSaved] = useState(() => {
    try { return parseCustomTitles(storage.getItem(STORAGE_KEY)) } catch { return {} }
  })
  const titles = useMemo(() => collectCustomTitles(saved, sessions), [saved, sessions])
  useEffect(() => {
    if (titles !== saved) setSaved(titles)
    try { storage.setItem(STORAGE_KEY, JSON.stringify(titles)) } catch { /* Keep in-memory titles when storage is unavailable. */ }
  }, [titles, saved, storage])
  useEffect(() => {
    setSessions((current) => syncSessionTitles(current, rawHistory, titles))
  }, [rawHistory, titles, sessions, setSessions])
  const history = useMemo(() => rawHistory.map((item) => {
    const title = resolveHistoryTitle(item, titles)
    return title === item.title ? item : { ...item, title }
  }), [rawHistory, titles])
  const searchResults = useMemo(() => rawSearchResults.map((result) => {
    const title = resolveHistoryTitle(result.session, titles)
    return title === result.session.title ? result : { ...result, session: { ...result.session, title } }
  }), [rawSearchResults, titles])
  return { history, searchResults, titles }
}

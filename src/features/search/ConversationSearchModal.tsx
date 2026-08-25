import type { RefObject } from 'react'
import { RefreshCw, Search, X } from 'lucide-react'
import type { AgentHealth, ConversationSearchResult, SearchIndexState } from '../../../electron/contracts'
import { AgentAvatar } from '../../components/AgentAvatar'
import type { AgentIconPreference } from '../agent-icons/types'
import { HighlightedSearchSnippet } from './HighlightedSearchSnippet'

interface ConversationSearchModalProps {
  inputRef: RefObject<HTMLInputElement>
  query: string
  results: readonly ConversationSearchResult[]
  indexState: SearchIndexState
  loading: boolean
  error: string
  rebuilding: boolean
  profilesById: ReadonlyMap<string, AgentHealth>
  agentIcons: Readonly<Record<string, AgentIconPreference>>
  onQueryChange: (query: string) => void
  onClose: () => void
  onRebuild: () => void
  onOpenResult: (result: ConversationSearchResult) => void
}

export function searchIndexProgress(indexState: SearchIndexState): number {
  if (indexState.phase !== 'indexing' || !indexState.discoveredSources) return 0
  return Math.round(indexState.processedSources / indexState.discoveredSources * 100)
}

export function ConversationSearchModal({
  inputRef,
  query,
  results,
  indexState,
  loading,
  error,
  rebuilding,
  profilesById,
  agentIcons,
  onQueryChange,
  onClose,
  onRebuild,
  onOpenResult,
}: ConversationSearchModalProps) {
  const searchActive = query.trim().length >= 2
  const clearQuery = (): void => {
    onQueryChange('')
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  return (
    <div className="conversation-search-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="conversation-search-modal" role="dialog" aria-modal="true" aria-labelledby="conversation-search-title">
        <div className="conversation-search-input">
          <Search size={17} aria-hidden="true" />
          <input
            ref={inputRef}
            autoFocus
            aria-label="Search conversations"
            placeholder="Search messages, titles, or paths"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query && <button className="search-clear" title="Clear search" onClick={clearQuery}><X size={14} /></button>}
          <kbd>Esc</kbd>
        </div>
        <header>
          <div>
            <strong id="conversation-search-title">Conversation search</strong>
            <span>
              {indexState.phase === 'indexing'
                ? `${indexState.processedSources}/${indexState.discoveredSources} files indexed`
                : `${indexState.indexedMessages.toLocaleString()} messages indexed`}
            </span>
          </div>
          <div className="conversation-search-actions">
            <button
              className="mini-icon-button"
              title="Rebuild search index"
              disabled={rebuilding || indexState.phase === 'indexing'}
              onClick={onRebuild}
            >
              <RefreshCw className={rebuilding ? 'spinning' : ''} size={14} />
            </button>
            <button className="mini-icon-button" title="Close" onClick={onClose}><X size={15} /></button>
          </div>
        </header>
        <span className="search-index-progress" aria-hidden="true">
          <span style={{ width: `${searchIndexProgress(indexState)}%` }} />
        </span>
        <div className="conversation-search-results">
          {searchActive && results.map((result) => {
            const profile = profilesById.get(result.session.agentId)
            return (
              <button className="conversation-search-result" key={result.id} onClick={() => onOpenResult(result)}>
                <AgentAvatar
                  agentId={result.session.agentId}
                  className="neutral"
                  color={profile?.color}
                  preference={agentIcons[result.session.agentId] ?? { mode: 'monogram' }}
                />
                <span className="conversation-search-copy">
                  <span className="conversation-search-title">
                    <strong>{result.session.title}</strong>
                    <small>{result.role === 'user' ? 'You' : result.session.agentId}</small>
                  </span>
                  <span className="conversation-search-snippet"><HighlightedSearchSnippet text={result.snippet} /></span>
                  <small>{result.session.accountEmail} · {result.session.cwd}</small>
                </span>
              </button>
            )
          })}
          {searchActive && loading && !results.length && <p className="conversation-search-empty">Searching local conversations...</p>}
          {searchActive && !loading && !error && !results.length && indexState.phase === 'indexing' && (
            <p className="conversation-search-empty">Indexing local conversations...</p>
          )}
          {searchActive && !loading && !error && !results.length && indexState.phase !== 'indexing' && (
            <p className="conversation-search-empty">No matching messages</p>
          )}
          {searchActive && error && <p className="conversation-search-empty error">{error}</p>}
        </div>
      </section>
    </div>
  )
}

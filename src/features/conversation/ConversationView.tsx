import { memo, useEffect, useLayoutEffect, useRef } from 'react'
import { Bot, UserRound } from 'lucide-react'
import type { ConversationHistory } from '../../../electron/contracts'
import { MarkdownContent } from './MarkdownContent'
import { formatConversationTimestamp } from './conversation-display'

interface ConversationViewProps {
  conversation: ConversationHistory | null
  loading: boolean
  loadingOlder: boolean
  error: string
  highlightMessageId: string
  onOpenExternal: (url: string) => void
  onLoadOlder: (before: number) => void
}

interface ScrollAnchor {
  firstMessageId: string
  scrollHeight: number
  scrollTop: number
}

function ConversationViewComponent({
  conversation,
  loading,
  loadingOlder,
  error,
  highlightMessageId,
  onOpenExternal,
  onLoadOlder,
}: ConversationViewProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const olderSentinelRef = useRef<HTMLDivElement>(null)
  const messageRefs = useRef(new Map<string, HTMLElement>())
  const anchorRef = useRef<ScrollAnchor | null>(null)
  const shownSessionKeyRef = useRef('')
  const scrolledHighlightRef = useRef('')

  const sessionKey = conversation?.session.key ?? ''
  const firstMessageId = conversation?.messages[0]?.id ?? ''
  const olderCursor = conversation?.olderCursor
  const hasOlder = olderCursor !== undefined

  const requestOlder = (): void => {
    const list = listRef.current
    if (olderCursor === undefined || loadingOlder || !list) return
    anchorRef.current = { firstMessageId, scrollHeight: list.scrollHeight, scrollTop: list.scrollTop }
    onLoadOlder(olderCursor)
  }
  const requestOlderRef = useRef(requestOlder)
  requestOlderRef.current = requestOlder

  const olderSentinelVisible = (): boolean => {
    const list = listRef.current
    const sentinel = olderSentinelRef.current
    if (!list || !sentinel) return false
    return sentinel.getBoundingClientRect().bottom >= list.getBoundingClientRect().top - 200
  }

  // A newly shown conversation opens on its latest messages unless a search
  // hit is being highlighted.
  useLayoutEffect(() => {
    if (!sessionKey || shownSessionKeyRef.current === sessionKey) return
    shownSessionKeyRef.current = sessionKey
    scrolledHighlightRef.current = ''
    anchorRef.current = null
    const list = listRef.current
    if (list && !highlightMessageId) list.scrollTop = list.scrollHeight
  }, [sessionKey, highlightMessageId])

  // Older pages are prepended above the viewport; keep what the reader was
  // looking at in place, then keep paging while the sentinel is still visible.
  useLayoutEffect(() => {
    const list = listRef.current
    const anchor = anchorRef.current
    if (!list || !anchor || anchor.firstMessageId === firstMessageId) return undefined
    anchorRef.current = null
    list.scrollTop = anchor.scrollTop + (list.scrollHeight - anchor.scrollHeight)
    const frame = requestAnimationFrame(() => {
      if (olderSentinelVisible()) requestOlderRef.current()
    })
    return () => cancelAnimationFrame(frame)
  }, [firstMessageId])

  useEffect(() => {
    const list = listRef.current
    const sentinel = olderSentinelRef.current
    if (!list || !sentinel) return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) requestOlderRef.current()
    }, { root: list, rootMargin: '200px 0px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasOlder, sessionKey])

  useEffect(() => {
    if (!conversation || !highlightMessageId || scrolledHighlightRef.current === highlightMessageId) return undefined
    const element = messageRefs.current.get(highlightMessageId)
    if (!element) return undefined
    scrolledHighlightRef.current = highlightMessageId
    const frame = requestAnimationFrame(() => element.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    return () => cancelAnimationFrame(frame)
  }, [conversation, highlightMessageId])

  if (loading) return (
    <div className="history-placeholder history-loading" role="status">
      <span className="history-loading-track"><span /></span>
      <span>Loading conversation</span>
    </div>
  )
  if (error) return <div className="history-placeholder error">{error}</div>
  if (!conversation) return <div className="history-placeholder">Select a conversation from the sidebar.</div>

  return (
    <section className="conversation-view">
      <div className="message-list" ref={listRef}>
        {hasOlder && (
          <div className="message-list-older" ref={olderSentinelRef}>
            {loadingOlder
              ? <span className="history-loading-track"><span /></span>
              : <button type="button" onClick={requestOlder}>Load earlier messages</button>}
          </div>
        )}
        {conversation.messages.map((message) => {
          const timestamp = formatConversationTimestamp(message.timestamp)
          return (
            <article
              className={`message-row ${message.role} ${message.id === highlightMessageId ? 'search-match' : ''}`}
              key={message.id}
              ref={(element) => {
                if (element) messageRefs.current.set(message.id, element)
                else messageRefs.current.delete(message.id)
              }}
            >
              <div className="message-role">
                <span className="message-author">
                  {message.role === 'user' ? <UserRound size={16} /> : <Bot size={16} />}
                  <strong>{message.role === 'user' ? 'You' : conversation.session.agentId}</strong>
                </span>
                {timestamp && <time dateTime={timestamp.dateTime}>{timestamp.label}</time>}
              </div>
              <MarkdownContent text={message.text} onOpenExternal={onOpenExternal} />
            </article>
          )
        })}
      </div>
    </section>
  )
}

function conversationViewPropsEqual(previous: ConversationViewProps, next: ConversationViewProps): boolean {
  return previous.conversation === next.conversation
    && previous.loading === next.loading
    && previous.loadingOlder === next.loadingOlder
    && previous.error === next.error
    && previous.highlightMessageId === next.highlightMessageId
    && previous.onOpenExternal === next.onOpenExternal
}

// `onLoadOlder` is recreated by the parent on every render; it is read
// through a ref, so it is left out of the comparison on purpose.
export const ConversationView = memo(ConversationViewComponent, conversationViewPropsEqual)

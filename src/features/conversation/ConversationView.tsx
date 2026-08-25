import { memo, useEffect, useRef } from 'react'
import { Bot, UserRound } from 'lucide-react'
import type { ConversationHistory } from '../../../electron/contracts'
import { MarkdownContent } from './MarkdownContent'
import { formatConversationTimestamp } from './conversation-display'

interface ConversationViewProps {
  conversation: ConversationHistory | null
  loading: boolean
  error: string
  highlightMessageId: string
  onOpenExternal: (url: string) => void
}

function ConversationViewComponent({
  conversation,
  loading,
  error,
  highlightMessageId,
  onOpenExternal,
}: ConversationViewProps) {
  const messageRefs = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    if (!conversation || !highlightMessageId) return undefined
    const frame = requestAnimationFrame(() => {
      messageRefs.current.get(highlightMessageId)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
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
      <div className="message-list">
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

export const ConversationView = memo(ConversationViewComponent)

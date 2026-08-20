import { useEffect, useRef } from 'react'
import { Bot, UserRound } from 'lucide-react'
import type { ConversationHistory } from '../../electron/contracts'

interface ConversationViewProps {
  conversation: ConversationHistory | null
  loading: boolean
  error: string
  highlightMessageId: string
}

export function ConversationView({ conversation, loading, error, highlightMessageId }: ConversationViewProps) {
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
        {conversation.messages.map((message) => (
          <article
            className={`message-row ${message.role} ${message.id === highlightMessageId ? 'search-match' : ''}`}
            key={message.id}
            ref={(element) => {
              if (element) messageRefs.current.set(message.id, element)
              else messageRefs.current.delete(message.id)
            }}
          >
            <div className="message-role">
              {message.role === 'user' ? <UserRound size={16} /> : <Bot size={16} />}
              <strong>{message.role === 'user' ? 'You' : conversation.session.agentId}</strong>
              {message.timestamp && <time>{new Date(message.timestamp).toLocaleString()}</time>}
            </div>
            <pre>{message.text}</pre>
          </article>
        ))}
      </div>
    </section>
  )
}

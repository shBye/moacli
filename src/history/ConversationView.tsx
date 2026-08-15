import { Bot, UserRound } from 'lucide-react'
import type { ConversationHistory } from '../../electron/contracts'

interface ConversationViewProps {
  conversation: ConversationHistory | null
  loading: boolean
  error: string
}

export function ConversationView({ conversation, loading, error }: ConversationViewProps) {
  if (loading) return (
    <div className="history-placeholder history-loading" role="status">
      <span className="history-loading-track"><span /></span>
      <span>대화 불러오는 중</span>
    </div>
  )
  if (error) return <div className="history-placeholder error">{error}</div>
  if (!conversation) return <div className="history-placeholder">Select a conversation from the sidebar.</div>

  return (
    <section className="conversation-view">
      <div className="message-list">
        {conversation.messages.map((message) => (
          <article className={`message-row ${message.role}`} key={message.id}>
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

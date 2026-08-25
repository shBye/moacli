import { memo, useMemo, type MouseEvent } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { normalizeExternalConversationUrl } from './conversation-display'

interface MarkdownContentProps {
  text: string
  onOpenExternal: (url: string) => void
}

const MARKDOWN_PLUGINS = [remarkGfm, remarkBreaks]

function MarkdownContentComponent({ text, onOpenExternal }: MarkdownContentProps) {
  const components = useMemo<Components>(() => ({
    a: ({ node: _node, href, children, ...props }) => {
      const externalUrl = normalizeExternalConversationUrl(href)
      if (!externalUrl) return <span className="markdown-link-disabled">{children}</span>
      const openLink = (event: MouseEvent<HTMLAnchorElement>): void => {
        event.preventDefault()
        onOpenExternal(externalUrl)
      }
      return (
        <a {...props} href={externalUrl} rel="noreferrer" onClick={openLink}>
          {children}
        </a>
      )
    },
    img: ({ node: _node, alt }) => (
      <span className="markdown-image-placeholder" role="img" aria-label={alt || 'Markdown image'}>
        [Image{alt ? `: ${alt}` : ''}]
      </span>
    ),
    table: ({ node: _node, ...props }) => (
      <div className="markdown-table-scroll">
        <table {...props} />
      </div>
    ),
  }), [onOpenExternal])

  return (
    <div className="message-markdown">
      <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  )
}

export const MarkdownContent = memo(MarkdownContentComponent)

export function HighlightedSearchSnippet({ text }: { text: string }) {
  const parts = text.split(/([\uE000\uE001])/)
  let highlighted = false
  return (
    <span>
      {parts.map((part, index) => {
        if (part === '\uE000') {
          highlighted = true
          return null
        }
        if (part === '\uE001') {
          highlighted = false
          return null
        }
        return highlighted ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>
      })}
    </span>
  )
}

import { useEffect, useState } from 'react'
import type { CliAgentApi } from '../../../electron/contracts'
import { MarkdownContent } from '../conversation/MarkdownContent'

export function TaskResultDetails({ api, taskId }: { api: CliAgentApi; taskId: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!open || text !== null) return
    let live = true
    setError('')
    void api.getSessionTaskResult(taskId).then((result) => {
      if (live) setText(result)
    }).catch((reason) => { if (live) setError(String(reason)) })
    return () => { live = false }
  }, [api, taskId, open, text, attempt])
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Result</summary>
    {open && <>
      {error ? <p role="alert" className="review-error">{error} <button className="secondary-button" onClick={() => setAttempt((value) => value + 1)}>Retry loading</button></p>
        : text === null ? <p role="status">Loading result…</p>
          : <><MarkdownContent text={text || 'No text result.'} onOpenExternal={api.openExternal} /><button className="secondary-button" onClick={() => api.writeTerminalClipboard(text)}>Copy result</button></>}
    </>}
  </details>
}

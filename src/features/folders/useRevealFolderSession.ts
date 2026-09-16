import { useCallback, useEffect, useRef } from 'react'
import { folderRevealScrollDelta } from './folder-expansion'

export function useRevealFolderSession(rows: { current: Map<string, HTMLDivElement> }) {
  const frame = useRef(0)
  const generation = useRef(0)
  useEffect(() => () => {
    generation.current++
    cancelAnimationFrame(frame.current)
  }, [])
  return useCallback((id: string | null) => {
    const request = ++generation.current
    cancelAnimationFrame(frame.current)
    if (!id) return
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(async () => {
        const row = rows.current.get(id)
        const contents = row?.closest('.folder-contents')
        const container = row?.closest<HTMLElement>('.folder-tree')
        if (!row || !container || !contents?.classList.contains('open')) return
        await Promise.allSettled(contents.getAnimations().map((animation) => animation.finished))
        if (request !== generation.current || !row.isConnected || !contents.classList.contains('open') || !row.getClientRects().length) return
        const item = row.getBoundingClientRect()
        const viewport = container.getBoundingClientRect()
        const top = viewport.top + container.clientTop
        const delta = folderRevealScrollDelta(item.top, item.bottom, top, top + container.clientHeight)
        if (delta) container.scrollTop += delta
      })
    })
  }, [rows])
}

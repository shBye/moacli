import type { TerminalClipboardContent } from '../../electron/contracts'

export interface PasteShortcut {
  altKey: boolean
  code: string
  ctrlKey: boolean
  metaKey: boolean
}

export function isTerminalPasteShortcut(shortcut: PasteShortcut): boolean {
  return (shortcut.ctrlKey || shortcut.metaKey)
    && !shortcut.altKey
    && shortcut.code === 'KeyV'
}

export function toTerminalPasteText(content: TerminalClipboardContent): string | null {
  if (content.kind === 'text') return content.value || null
  if (content.kind !== 'image') return null

  const paths = content.values?.length ? content.values : [content.value]
  const nonEmptyPaths = paths.filter((path) => path.length > 0)
  return nonEmptyPaths.length
    ? nonEmptyPaths.map((path) => `"${path}"`).join(' ')
    : null
}

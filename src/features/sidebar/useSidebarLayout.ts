import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  DEFAULT_FOLDER_PANE_HEIGHT,
  DEFAULT_SIDEBAR_WIDTH,
  FOLDER_PANE_HEIGHT_RANGE,
  SIDEBAR_WIDTH_RANGE,
  clampFolderPaneHeight,
  clampSidebarWidth,
  folderPaneHeightForKey,
  sidebarWidthForKey,
} from './sidebar-layout-policy'
import {
  readSidebarLayout,
  saveFolderPaneHeight,
  saveSidebarCollapsed,
  saveSidebarWidth,
  type SidebarLayoutStorage,
} from './sidebar-layout-storage'

export function useSidebarLayout(storage: SidebarLayoutStorage) {
  const initialLayoutRef = useRef<ReturnType<typeof readSidebarLayout> | null>(null)
  if (!initialLayoutRef.current) initialLayoutRef.current = readSidebarLayout(storage, window.innerHeight)
  const initialLayout = initialLayoutRef.current
  const [sidebarWidth, setSidebarWidth] = useState(initialLayout.width)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialLayout.collapsed)
  const [folderPaneHeight, setFolderPaneHeight] = useState(initialLayout.folderPaneHeight)
  const appBodyRef = useRef<HTMLDivElement>(null)
  const folderTreeRef = useRef<HTMLElement>(null)
  const activeResizeCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => {
    activeResizeCleanupRef.current?.()
  }, [])

  const setAndSaveSidebarWidth = useCallback((next: number): void => {
    const width = clampSidebarWidth(next)
    setSidebarWidth(width)
    saveSidebarWidth(storage, width)
  }, [storage])

  const toggleSidebar = useCallback((): void => {
    setSidebarCollapsed((current) => {
      const next = !current
      saveSidebarCollapsed(storage, next)
      return next
    })
  }, [storage])

  const beginSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    activeResizeCleanupRef.current?.()
    const startX = event.clientX
    const startWidth = sidebarWidth
    let latestWidth = startWidth

    const onPointerMove = (moveEvent: PointerEvent): void => {
      latestWidth = clampSidebarWidth(startWidth + moveEvent.clientX - startX)
      appBodyRef.current?.style.setProperty('--sidebar-width', `${latestWidth}px`)
    }
    const cleanup = (): void => {
      document.body.classList.remove('sidebar-resizing')
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (activeResizeCleanupRef.current === cleanup) activeResizeCleanupRef.current = null
    }
    const finish = (): void => {
      cleanup()
      setSidebarWidth(latestWidth)
      saveSidebarWidth(storage, latestWidth)
    }

    document.body.classList.add('sidebar-resizing')
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    activeResizeCleanupRef.current = cleanup
  }, [sidebarWidth, storage])

  const resizeSidebarWithKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const width = sidebarWidthForKey(event.key, sidebarWidth)
    if (width === null) return
    event.preventDefault()
    setAndSaveSidebarWidth(width)
  }, [setAndSaveSidebarWidth, sidebarWidth])

  const setAndSaveFolderPaneHeight = useCallback((next: number): void => {
    const height = clampFolderPaneHeight(next, window.innerHeight)
    setFolderPaneHeight(height)
    saveFolderPaneHeight(storage, height)
  }, [storage])

  const beginFolderPaneResize = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    activeResizeCleanupRef.current?.()
    const startY = event.clientY
    const startHeight = folderPaneHeight
    let latestHeight = startHeight

    const onPointerMove = (moveEvent: PointerEvent): void => {
      latestHeight = clampFolderPaneHeight(startHeight + moveEvent.clientY - startY, window.innerHeight)
      if (folderTreeRef.current) folderTreeRef.current.style.height = `${latestHeight}px`
    }
    const cleanup = (): void => {
      document.body.classList.remove('folder-pane-resizing')
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (activeResizeCleanupRef.current === cleanup) activeResizeCleanupRef.current = null
    }
    const finish = (): void => {
      cleanup()
      setFolderPaneHeight(latestHeight)
      saveFolderPaneHeight(storage, latestHeight)
    }

    document.body.classList.add('folder-pane-resizing')
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    activeResizeCleanupRef.current = cleanup
  }, [folderPaneHeight, storage])

  const resizeFolderPaneWithKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const height = folderPaneHeightForKey(event.key, folderPaneHeight, window.innerHeight)
    if (height === null) return
    event.preventDefault()
    setAndSaveFolderPaneHeight(height)
  }, [folderPaneHeight, setAndSaveFolderPaneHeight])

  return {
    sidebarWidth,
    sidebarCollapsed,
    folderPaneHeight,
    sidebarWidthRange: SIDEBAR_WIDTH_RANGE,
    folderPaneHeightRange: FOLDER_PANE_HEIGHT_RANGE,
    appBodyRef,
    folderTreeRef,
    toggleSidebar,
    beginSidebarResize,
    resizeSidebarWithKeyboard,
    resetSidebarWidth: () => setAndSaveSidebarWidth(DEFAULT_SIDEBAR_WIDTH),
    beginFolderPaneResize,
    resizeFolderPaneWithKeyboard,
    resetFolderPaneHeight: () => setAndSaveFolderPaneHeight(DEFAULT_FOLDER_PANE_HEIGHT),
  }
}

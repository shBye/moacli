import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { edgeEnabledOptionIndex, nextEnabledOptionIndex } from './select-box-policy'

export interface SelectBoxOption<Value extends string = string> {
  value: Value
  label: string
  disabled?: boolean
}

interface MenuPosition {
  left: number
  top: number
  width: number
  maxHeight: number
  origin: 'top' | 'bottom'
  accent: string
  appBackground: string
  appForeground: string
  fontFamily: string
}

interface SelectBoxProps<Value extends string> {
  value: Value
  options: readonly SelectBoxOption<Value>[]
  onChange: (value: Value) => void
  ariaLabel: string
  className?: string
  disabled?: boolean
  placeholder?: string
}

const VIEWPORT_MARGIN = 8
const MENU_GAP = 5
const MAX_MENU_HEIGHT = 240
const OPTION_HEIGHT = 33

export function SelectBox<Value extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
  disabled = false,
  placeholder = 'Select',
}: SelectBoxProps<Value>) {
  const id = useId().replace(/:/g, '')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef(new Map<number, HTMLButtonElement>())
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const selectedIndex = options.findIndex((option) => option.value === value)
  const selectedOption = options[selectedIndex]

  const updateMenuPosition = useCallback((): void => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const computedStyle = window.getComputedStyle(trigger)
    const desiredHeight = Math.min(MAX_MENU_HEIGHT, options.length * OPTION_HEIGHT + 8)
    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN - MENU_GAP
    const spaceAbove = rect.top - VIEWPORT_MARGIN - MENU_GAP
    const openAbove = spaceBelow < Math.min(desiredHeight, 150) && spaceAbove > spaceBelow
    const maxHeight = Math.max(72, Math.min(desiredHeight, openAbove ? spaceAbove : spaceBelow))
    const width = Math.min(Math.max(rect.width, 150), window.innerWidth - VIEWPORT_MARGIN * 2)
    const left = Math.min(
      window.innerWidth - width - VIEWPORT_MARGIN,
      Math.max(VIEWPORT_MARGIN, rect.left),
    )
    setMenuPosition({
      left,
      top: openAbove ? Math.max(VIEWPORT_MARGIN, rect.top - maxHeight - MENU_GAP) : rect.bottom + MENU_GAP,
      width,
      maxHeight,
      origin: openAbove ? 'bottom' : 'top',
      accent: computedStyle.getPropertyValue('--acc').trim() || '#E9B45C',
      appBackground: computedStyle.getPropertyValue('--app-bg').trim() || '#121418',
      appForeground: computedStyle.getPropertyValue('--app-fg').trim() || '#E7E9EA',
      fontFamily: computedStyle.fontFamily,
    })
  }, [options.length])

  const close = useCallback((restoreFocus = false): void => {
    setOpen(false)
    setHighlightedIndex(-1)
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  const openMenu = useCallback((preferredIndex = selectedIndex): void => {
    if (disabled || !options.length) return
    const fallbackIndex = edgeEnabledOptionIndex(options, 'first')
    setHighlightedIndex(preferredIndex >= 0 && !options[preferredIndex]?.disabled ? preferredIndex : fallbackIndex)
    updateMenuPosition()
    setOpen(true)
  }, [disabled, options, selectedIndex, updateMenuPosition])

  const selectOption = useCallback((index: number): void => {
    const option = options[index]
    if (!option || option.disabled) return
    if (option.value !== value) onChange(option.value)
    close(true)
  }, [close, onChange, options, value])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      close()
    }
    const onViewportChange = (): void => updateMenuPosition()
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [close, open, updateMenuPosition])

  useEffect(() => {
    if (!open || highlightedIndex < 0) return undefined
    const frame = window.requestAnimationFrame(() => {
      optionRefs.current.get(highlightedIndex)?.scrollIntoView({ block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [highlightedIndex, open])

  const moveHighlight = (direction: 1 | -1): void => {
    const start = highlightedIndex >= 0 ? highlightedIndex : selectedIndex
    setHighlightedIndex(nextEnabledOptionIndex(options, start, direction))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        const direction = event.key === 'ArrowDown' ? 1 : -1
        const start = selectedIndex >= 0 ? selectedIndex : direction === 1 ? -1 : 0
        openMenu(nextEnabledOptionIndex(options, start, direction))
      } else {
        moveHighlight(event.key === 'ArrowDown' ? 1 : -1)
      }
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      if (!open) openMenu()
      setHighlightedIndex(edgeEnabledOptionIndex(options, event.key === 'Home' ? 'first' : 'last'))
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!open) openMenu()
      else if (highlightedIndex >= 0) selectOption(highlightedIndex)
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') {
      close()
    }
  }

  const menuStyle = menuPosition ? ({
    left: menuPosition.left,
    top: menuPosition.top,
    width: menuPosition.width,
    maxHeight: menuPosition.maxHeight,
    '--select-origin': menuPosition.origin,
    '--select-shift': menuPosition.origin === 'top' ? '-3px' : '3px',
    '--select-accent': menuPosition.accent,
    '--select-app-bg': menuPosition.appBackground,
    '--select-app-fg': menuPosition.appForeground,
    '--select-font-family': menuPosition.fontFamily,
  } as CSSProperties) : undefined

  return (
    <div className={`select-box ${open ? 'open' : ''} ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className="select-box-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        aria-activedescendant={open && highlightedIndex >= 0 ? `${id}-option-${highlightedIndex}` : undefined}
        disabled={disabled}
        onClick={() => open ? close() : openMenu()}
        onKeyDown={onKeyDown}
      >
        <span className={`select-box-value ${selectedOption ? '' : 'placeholder'}`}>{selectedOption?.label ?? placeholder}</span>
        <ChevronDown className="select-box-chevron" size={13} aria-hidden="true" />
      </button>
      {open && menuPosition && createPortal(
        <div
          ref={menuRef}
          id={`${id}-menu`}
          className="select-box-menu"
          role="listbox"
          aria-label={ariaLabel}
          style={menuStyle}
        >
          {options.map((option, index) => {
            const selected = option.value === value
            const highlighted = highlightedIndex === index
            return (
              <button
                ref={(element) => {
                  if (element) optionRefs.current.set(index, element)
                  else optionRefs.current.delete(index)
                }}
                id={`${id}-option-${index}`}
                type="button"
                className={`select-box-option ${selected ? 'selected' : ''} ${highlighted ? 'highlighted' : ''}`}
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                key={option.value}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => selectOption(index)}
              >
                <span>{option.label}</span>
                {selected && <Check size={12} aria-hidden="true" />}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}

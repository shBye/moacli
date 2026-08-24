import {
  lazy,
  Suspense,
  useMemo,
  useState,
  type ComponentType,
  type LazyExoticComponent,
} from 'react'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import dynamicIconImports from 'lucide-react/dynamicIconImports'

export type LucideIconName = keyof typeof dynamicIconImports

type DynamicIconComponent = ComponentType<{ size?: string | number }>

const ICON_PAGE_SIZE = 120
const iconNames = Object.keys(dynamicIconImports) as LucideIconName[]
const iconComponents = new Map<LucideIconName, LazyExoticComponent<DynamicIconComponent>>()

export function DynamicLucideIcon({ name, size }: { name: string; size?: number }) {
  const loader = dynamicIconImports[name as LucideIconName]
  if (!loader) return <span className="dynamic-icon-placeholder" />

  let Icon = iconComponents.get(name as LucideIconName)
  if (!Icon) {
    Icon = lazy(loader as unknown as () => Promise<{ default: DynamicIconComponent }>)
    iconComponents.set(name as LucideIconName, Icon)
  }
  return <Suspense fallback={<span className="dynamic-icon-placeholder" />}><Icon size={size} /></Suspense>
}

interface LucideIconPickerProps {
  agentLabel: string
  currentIconName?: string
  onSelect: (name: LucideIconName) => void
  onClose: () => void
}

export function LucideIconPicker({ agentLabel, currentIconName, onSelect, onClose }: LucideIconPickerProps) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const filteredNames = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return normalized ? iconNames.filter((name) => name.includes(normalized)) : iconNames
  }, [query])
  const pageCount = Math.max(1, Math.ceil(filteredNames.length / ICON_PAGE_SIZE))
  const visibleNames = filteredNames.slice(page * ICON_PAGE_SIZE, (page + 1) * ICON_PAGE_SIZE)

  return (
    <div className="icon-picker-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="icon-picker-modal" role="dialog" aria-modal="true" aria-labelledby="lucide-picker-title">
        <header>
          <div>
            <h2 id="lucide-picker-title">Lucide icons</h2>
            <p>{agentLabel}</p>
          </div>
          <button className="icon-button" title="Close" onClick={onClose}><X size={16} /></button>
        </header>
        <label className="icon-picker-search">
          <Search size={14} aria-hidden="true" />
          <input autoFocus value={query} placeholder="Search icon names" onChange={(event) => {
            setQuery(event.target.value)
            setPage(0)
          }} />
        </label>
        <div className="lucide-icon-grid scroll">
          {visibleNames.map((name) => (
            <button
              className={currentIconName === name ? 'active' : ''}
              title={name}
              key={name}
              onClick={() => onSelect(name)}
            >
              <DynamicLucideIcon name={name} size={18} />
            </button>
          ))}
          {!visibleNames.length && <p className="icon-picker-empty">No matching icons</p>}
        </div>
        <footer>
          <span>{filteredNames.length.toLocaleString()} icons</span>
          <div className="icon-picker-pagination">
            <button title="Previous page" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}><ChevronLeft size={15} /></button>
            <span>{Math.min(page + 1, pageCount)} / {pageCount}</span>
            <button title="Next page" disabled={page >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}><ChevronRight size={15} /></button>
          </div>
        </footer>
      </section>
    </div>
  )
}

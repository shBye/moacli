import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface SectionHeadingProps {
  label: string
  count: string | number
  open: boolean
  onToggle: () => void
  actions?: ReactNode
}

export function SectionHeading({ label, count, open, onToggle, actions }: SectionHeadingProps) {
  return (
    <div className="sidebar-heading">
      <button className="section-toggle" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{label}</span>
      </button>
      <span className="section-count">{count}</span>
      {actions}
    </div>
  )
}

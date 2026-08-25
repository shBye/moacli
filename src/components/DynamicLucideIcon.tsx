import { lazy, Suspense } from 'react'
import type { LucideIconName } from '../icons/LucideIconBrowser'

const LazyDynamicLucideIcon = lazy(() => import('../icons/LucideIconBrowser').then((module) => ({ default: module.DynamicLucideIcon })))

export function DynamicLucideIcon({ name, size }: { name: LucideIconName; size?: number }) {
  return <Suspense fallback={<span className="dynamic-icon-placeholder" />}><LazyDynamicLucideIcon name={name} size={size} /></Suspense>
}

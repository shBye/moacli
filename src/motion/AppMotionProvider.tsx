import type { ReactNode } from 'react'
import { LazyMotion, MotionConfig } from 'motion/react'
import { MOTION_TRANSITIONS } from './tokens'

const loadMotionFeatures = () => import('./features').then((module) => module.default)

export function AppMotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadMotionFeatures} strict>
      <MotionConfig reducedMotion="user" transition={MOTION_TRANSITIONS.default}>
        {children}
      </MotionConfig>
    </LazyMotion>
  )
}

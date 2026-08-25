import type { Transition } from 'motion/react'

export const MOTION_TRANSITIONS = {
  default: {
    type: 'tween',
    duration: 0.16,
    ease: [0.2, 0.72, 0.25, 1],
  },
  layout: {
    type: 'spring',
    stiffness: 500,
    damping: 42,
    mass: 0.65,
  },
  exit: {
    type: 'tween',
    duration: 0.12,
    ease: [0.4, 0, 1, 1],
  },
} satisfies Record<string, Transition>

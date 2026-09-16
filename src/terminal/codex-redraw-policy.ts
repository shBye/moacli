export function shouldFollowCodexRedraw(position: { active: boolean; buffer: string; base: number; viewport: number }): boolean {
  return position.active && position.buffer === 'normal' && position.base - position.viewport <= 1
}

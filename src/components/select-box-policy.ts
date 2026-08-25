export interface SelectableOption {
  disabled?: boolean
}

export interface StringOption {
  value: string
  label: string
}

export function createIntegerOptions(minimum: number, maximum: number): readonly StringOption[] {
  const start = Math.ceil(Math.min(minimum, maximum))
  const end = Math.floor(Math.max(minimum, maximum))
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const value = String(start + index)
    return { value, label: value }
  })
}

export function nextEnabledOptionIndex(
  options: readonly SelectableOption[],
  currentIndex: number,
  direction: 1 | -1,
): number {
  if (!options.length) return -1
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (currentIndex + direction * offset + options.length) % options.length
    if (!options[index]?.disabled) return index
  }
  return -1
}

export function edgeEnabledOptionIndex(
  options: readonly SelectableOption[],
  edge: 'first' | 'last',
): number {
  const start = edge === 'first' ? 0 : options.length - 1
  const direction = edge === 'first' ? 1 : -1
  for (let index = start; index >= 0 && index < options.length; index += direction) {
    if (!options[index]?.disabled) return index
  }
  return -1
}

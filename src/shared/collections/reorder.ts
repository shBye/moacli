export type RelativeEdge = 'before' | 'after'

export function reorderByKey<T>(
  items: readonly T[],
  draggedKey: string,
  targetKey: string,
  edge: RelativeEdge,
  keyOf: (item: T) => string,
): T[] {
  if (!draggedKey || draggedKey === targetKey) return [...items]
  const draggedIndex = items.findIndex((item) => keyOf(item) === draggedKey)
  if (draggedIndex < 0 || !items.some((item) => keyOf(item) === targetKey)) return [...items]

  const next = [...items]
  const [dragged] = next.splice(draggedIndex, 1)
  const targetIndex = next.findIndex((item) => keyOf(item) === targetKey)
  next.splice(targetIndex + (edge === 'after' ? 1 : 0), 0, dragged)
  return next
}

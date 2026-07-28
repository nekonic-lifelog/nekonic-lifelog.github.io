import { daysBetween, logicalDay, type DayKey } from './day'
import type { Snapshot } from '../data/store'
import type { Definition, Todo } from './types'

export function visibleDefinitions(snapshot: Snapshot): Definition[] {
  return snapshot.definitions
    .filter((d) => !d.deleted && !d.hidden && !d.archived)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

export function managedDefinitions(snapshot: Snapshot): Definition[] {
  return snapshot.definitions
    .filter((d) => !d.deleted && !d.hidden)
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.order - b.order)
}

export function activeTodos(snapshot: Snapshot): Todo[] {
  return snapshot.todos.filter((t) => !t.deleted)
}

export function dueDayOf(todo: Todo, boundaryHour: number): DayKey | null {
  return todo.dueAt ? logicalDay(todo.dueAt, boundaryHour) : null
}

export interface DDayItem {
  todo: Todo
  due: DayKey
  remaining: number
}

export function ddayItems(
  snapshot: Snapshot,
  today: DayKey,
  boundaryHour: number,
): DDayItem[] {
  const items: DDayItem[] = []
  for (const todo of activeTodos(snapshot)) {
    if (!todo.pinned || todo.status === 'done') continue
    const due = dueDayOf(todo, boundaryHour)
    if (!due) continue
    items.push({ todo, due, remaining: daysBetween(due, today) })
  }
  return items.sort((a, b) => {
    const aPast = a.remaining < 0
    const bPast = b.remaining < 0
    if (aPast !== bPast) return aPast ? 1 : -1
    return aPast ? b.remaining - a.remaining : a.remaining - b.remaining
  })
}

export function todosDueBy(
  snapshot: Snapshot,
  day: DayKey,
  boundaryHour: number,
): Todo[] {
  return activeTodos(snapshot)
    .filter((t) => {
      if (t.status === 'done') return false
      const due = dueDayOf(t, boundaryHour)
      return due !== null && due <= day
    })
    .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))
}

export function formatRemaining(remaining: number): string {
  if (remaining === 0) return 'D-DAY'
  return remaining > 0 ? `D-${remaining}` : `D+${-remaining}`
}

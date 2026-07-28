import type { Snapshot } from '../data/store'
import { addDays, dayKeyToDate, weekdayLabel, weekdayOf, type DayKey } from './day'
import { activeTodos, dueDayOf } from './select'

export const WEEK_LENGTH = 7
export const DEFAULT_WEEK_START = 1

export interface WeekDay {
  day: DayKey
  weekday: number
  label: string
  dayOfMonth: number
  isToday: boolean
  isSelected: boolean
  todoCount: number
  doneCount: number
  hasOverdue: boolean
}

function normalizeStart(startsOn: number): number {
  const n = Number.isFinite(startsOn) ? Math.trunc(startsOn) : DEFAULT_WEEK_START
  return ((n % WEEK_LENGTH) + WEEK_LENGTH) % WEEK_LENGTH
}

export function weekStart(day: DayKey, startsOn: number = DEFAULT_WEEK_START): DayKey {
  const base = normalizeStart(startsOn)
  const diff = ((weekdayOf(day) - base) % WEEK_LENGTH + WEEK_LENGTH) % WEEK_LENGTH
  return addDays(day, -diff)
}

export function shiftWeek(anchor: DayKey, delta: number): DayKey {
  const steps = Number.isFinite(delta) ? Math.trunc(delta) : 0
  return addDays(anchor, steps * WEEK_LENGTH)
}

function countByDay(snapshot: Snapshot, boundaryHour: number) {
  const open = new Map<DayKey, number>()
  const done = new Map<DayKey, number>()
  for (const todo of activeTodos(snapshot)) {
    const due = dueDayOf(todo, boundaryHour)
    if (!due) continue
    const bucket = todo.status === 'done' ? done : open
    bucket.set(due, (bucket.get(due) ?? 0) + 1)
  }
  return { open, done }
}

export function weekDays(
  anchor: DayKey,
  today: DayKey,
  selected: DayKey,
  snapshot: Snapshot,
  boundaryHour: number,
  startsOn: number = DEFAULT_WEEK_START,
): WeekDay[] {
  const start = weekStart(anchor, startsOn)
  const { open, done } = countByDay(snapshot, boundaryHour)

  const days: WeekDay[] = []
  for (let i = 0; i < WEEK_LENGTH; i++) {
    const day = addDays(start, i)
    const date = dayKeyToDate(day)
    const weekday = date.getDay()
    const todoCount = open.get(day) ?? 0
    days.push({
      day,
      weekday,
      label: weekdayLabel(weekday),
      dayOfMonth: date.getDate(),
      isToday: day === today,
      isSelected: day === selected,
      todoCount,
      doneCount: done.get(day) ?? 0,
      hasOverdue: day < today && todoCount > 0,
    })
  }
  return days
}

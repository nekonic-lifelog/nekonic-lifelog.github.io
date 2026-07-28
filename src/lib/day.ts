import type { Clock } from './clock'

export type DayKey = string

const DAY_MS = 86_400_000

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function formatLocal(d: Date): DayKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function logicalDay(at: string | number | Date, boundaryHour: number): DayKey {
  const ms = at instanceof Date ? at.getTime() : new Date(at).getTime()
  if (Number.isNaN(ms)) throw new Error(`logicalDay: 해석할 수 없는 시각 ${String(at)}`)
  return formatLocal(new Date(ms - boundaryHour * 3_600_000))
}

export function todayKey(clock: Clock, boundaryHour: number): DayKey {
  return logicalDay(clock.now(), boundaryHour)
}

export function dayKeyToDate(key: DayKey): Date {
  const [y, m, d] = key.split('-').map(Number)
  if (y === undefined || m === undefined || d === undefined || Number.isNaN(y)) {
    throw new Error(`dayKeyToDate: 잘못된 DayKey ${key}`)
  }
  return new Date(y, m - 1, d)
}

export function addDays(key: DayKey, delta: number): DayKey {
  const d = dayKeyToDate(key)
  return formatLocal(new Date(d.getTime() + 12 * 3_600_000 + delta * DAY_MS))
}

export function weekdayOf(key: DayKey): number {
  return dayKeyToDate(key).getDay()
}

export function daysBetween(a: DayKey, b: DayKey): number {
  const ms = dayKeyToDate(a).getTime() - dayKeyToDate(b).getTime()
  return Math.round(ms / DAY_MS)
}

export function lastNDays(end: DayKey, n: number): DayKey[] {
  const out: DayKey[] = []
  for (let i = n - 1; i >= 0; i--) out.push(addDays(end, -i))
  return out
}

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday] ?? '?'
}

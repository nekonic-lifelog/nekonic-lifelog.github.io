import type { Clock } from './clock'
import { addDays, lastNDays, logicalDay, todayKey, weekdayOf, type DayKey } from './day'
import type { Aggregate, Definition, LogRecord, TargetPoint } from './types'

export interface StreakOptions {
  boundaryHour: number
  clock: Clock
}

export interface DayStatus {
  day: DayKey
  isTargetDay: boolean
  total: number
  count: number
  target: number | null
  achieved: boolean
  scored: boolean
}

export interface DayTally {
  sum: number
  count: number
  lastValue?: number
  lastAt?: string
  firstAt?: string
}

export function isScored(def: Definition): boolean {
  return def.scored !== false
}

export function aggregateOf(def: Definition): Aggregate {
  return def.aggregate ?? 'sum'
}

export function tallyValue(def: Definition, tally: DayTally): number {
  return aggregateOf(def) === 'last' ? (tally.lastValue ?? 0) : tally.sum
}

export function progressPercent(status: DayStatus): number {
  if (status.target !== null && status.target > 0) {
    return Math.min(100, (status.total / status.target) * 100)
  }
  return status.total > 0 ? 100 : 0
}

export interface HabitView {
  definition: Definition
  streak: number
  recent: DayStatus[]
  today: DayStatus
}

const MAX_WALK_DAYS = 20_000

export function dailyTotals(
  def: Definition,
  records: LogRecord[],
  boundaryHour: number,
): Map<DayKey, DayTally> {
  const totals = new Map<DayKey, DayTally>()
  const edges = new Map<DayKey, { first: number; last: number; lastId: string }>()

  for (const r of records) {
    if (r.deleted || r.defId !== def.id) continue
    const day = logicalDay(r.at, boundaryHour)
    const tally = totals.get(day) ?? { sum: 0, count: 0 }
    tally.sum += r.value
    tally.count += 1

    const at = new Date(r.at).getTime()
    const edge = edges.get(day)
    if (edge === undefined) {
      edges.set(day, { first: at, last: at, lastId: r.id })
      tally.firstAt = r.at
      tally.lastAt = r.at
      tally.lastValue = r.value
    } else {
      if (at > edge.last || (at === edge.last && r.id > edge.lastId)) {
        edge.last = at
        edge.lastId = r.id
        tally.lastAt = r.at
        tally.lastValue = r.value
      }
      if (at < edge.first) {
        edge.first = at
        tally.firstAt = r.at
      }
    }

    totals.set(day, tally)
  }

  return totals
}

export function effectiveTarget(
  def: Definition,
  day: DayKey,
  boundaryHour: number,
): number | null {
  if (def.kind === 'check') return null
  if (def.targetHistory.length === 0) return null

  const sorted = [...def.targetHistory].sort(
    (a, b) => new Date(a.from).getTime() - new Date(b.from).getTime(),
  )
  let chosen = sorted[0]!
  for (const point of sorted) {
    if (logicalDay(point.from, boundaryHour) <= day) chosen = point
    else break
  }
  return chosen.target
}

export function withNewTarget(
  history: TargetPoint[],
  target: number,
  now: string,
  boundaryHour: number,
): TargetPoint[] {
  const sorted = [...history].sort(
    (a, b) => new Date(a.from).getTime() - new Date(b.from).getTime(),
  )
  const last = sorted[sorted.length - 1]
  if (last && logicalDay(last.from, boundaryHour) === logicalDay(now, boundaryHour)) {
    sorted[sorted.length - 1] = { from: last.from, target }
    return sorted
  }
  return [...sorted, { from: now, target }]
}

export function isTargetDay(def: Definition, day: DayKey): boolean {
  const days = def.targetDays
  if (!days || days.length === 0) return true
  return days.includes(weekdayOf(day))
}

export function statusFrom(
  def: Definition,
  day: DayKey,
  totals: Map<DayKey, DayTally>,
  boundaryHour: number,
): DayStatus {
  const tally = totals.get(day) ?? { sum: 0, count: 0 }
  const { count } = tally
  const value = tallyValue(def, tally)
  const target = effectiveTarget(def, day, boundaryHour)
  const scored = isScored(def)
  const hit =
    def.kind === 'check' ? count >= 1 : target === null ? value > 0 : value >= target
  const achieved = scored && hit
  return {
    day,
    isTargetDay: isTargetDay(def, day),
    total: def.kind === 'check' ? count : value,
    count,
    target,
    achieved,
    scored,
  }
}

export function dayStatus(
  def: Definition,
  records: LogRecord[],
  day: DayKey,
  opts: StreakOptions,
): DayStatus {
  return statusFrom(def, day, dailyTotals(def, records, opts.boundaryHour), opts.boundaryHour)
}

function walkStreak(
  def: Definition,
  totals: Map<DayKey, DayTally>,
  today: DayKey,
  boundaryHour: number,
): number {
  if (!isScored(def)) return 0

  let floor = logicalDay(def.createdAt, boundaryHour)
  for (const day of totals.keys()) if (day < floor) floor = day

  const achieved = (day: DayKey) => statusFrom(def, day, totals, boundaryHour).achieved

  let streak = 0
  let day = today

  if (isTargetDay(def, today) && achieved(today)) streak++
  day = addDays(day, -1)

  for (let guard = 0; day >= floor && guard < MAX_WALK_DAYS; guard++) {
    if (isTargetDay(def, day)) {
      if (!achieved(day)) break
      streak++
    }
    day = addDays(day, -1)
  }

  return streak
}

export function computeStreak(
  def: Definition,
  records: LogRecord[],
  opts: StreakOptions,
): number {
  const totals = dailyTotals(def, records, opts.boundaryHour)
  return walkStreak(def, totals, todayKey(opts.clock, opts.boundaryHour), opts.boundaryHour)
}

export function habitView(
  def: Definition,
  records: LogRecord[],
  opts: StreakOptions,
  recentCount = 7,
): HabitView {
  const { boundaryHour } = opts
  const totals = dailyTotals(def, records, boundaryHour)
  const today = todayKey(opts.clock, boundaryHour)
  return {
    definition: def,
    streak: walkStreak(def, totals, today, boundaryHour),
    recent: lastNDays(today, recentCount).map((d) => statusFrom(def, d, totals, boundaryHour)),
    today: statusFrom(def, today, totals, boundaryHour),
  }
}

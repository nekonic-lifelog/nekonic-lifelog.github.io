import type { Snapshot } from '../data/store'
import { fixedClock } from './clock'
import {
  addDays,
  dayKeyToDate,
  daysBetween,
  lastNDays,
  logicalDay,
  todayKey,
  weekdayLabel,
  weekdayOf,
  type DayKey,
} from './day'
import {
  aggregateOf,
  computeStreak,
  dailyTotals,
  dayStatus,
  isScored,
  isTargetDay,
  statusFrom,
  tallyValue,
  type StreakOptions,
} from './streak'
import type { Aggregate, Book, Definition, JournalKind, LogRecord, Todo } from './types'

export type Period = 'week' | 'month' | 'year'

export interface Range {
  from: DayKey
  to: DayKey
}

function dayKey(year: number, month: number, day: number): DayKey {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function monthStart(total: number): DayKey {
  const year = Math.floor(total / 12)
  const month = ((total % 12) + 12) % 12
  return dayKey(year, month + 1, 1)
}

export function rangeFor(period: Period, today: DayKey, offset = 0): Range {
  const back = Math.min(0, Math.trunc(offset))
  const date = dayKeyToDate(today)
  const year = date.getFullYear()
  const month = date.getMonth() + 1

  if (period === 'week') {
    const start = addDays(today, -((date.getDay() + 6) % 7))
    const from = addDays(start, back * 7)
    return { from, to: addDays(from, 6) }
  }

  if (period === 'month') {
    const total = year * 12 + (month - 1) + back
    return { from: monthStart(total), to: addDays(monthStart(total + 1), -1) }
  }

  const shifted = year + back
  return { from: dayKey(shifted, 1, 1), to: dayKey(shifted, 12, 31) }
}

export function rangeLabel(period: Period, range: Range): string {
  if (period === 'year') return range.from.slice(0, 4)
  if (period === 'month') return range.from.slice(0, 7)
  return `${range.from} 주`
}

export function daysIn(range: Range): DayKey[] {
  const span = daysBetween(range.to, range.from) + 1
  return span > 0 ? lastNDays(range.to, span) : []
}

function holds(range: Range, day: DayKey): boolean {
  return day >= range.from && day <= range.to
}

function optsAt(day: DayKey, boundaryHour: number): StreakOptions {
  return { boundaryHour, clock: fixedClock(dayKeyToDate(day)) }
}

function percentOf(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0
}

function recordsOf(def: Definition, records: LogRecord[]): LogRecord[] {
  return records.filter((r) => !r.deleted && r.defId === def.id)
}

function countedDefinitions(snapshot: Snapshot): Definition[] {
  return snapshot.definitions
    .filter((d) => !d.deleted && !d.hidden)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

function firstCountedDay(
  def: Definition,
  own: LogRecord[],
  boundaryHour: number,
): DayKey {
  let floor = logicalDay(def.createdAt, boundaryHour)
  for (const record of own) {
    const day = logicalDay(record.at, boundaryHour)
    if (day < floor) floor = day
  }
  return floor
}

export interface HabitStat {
  definition: Definition
  targetDays: number
  achievedDays: number
  percent: number
  longestStreak: number
  currentStreak: number
}

export function longestStreakIn(
  def: Definition,
  records: LogRecord[],
  range: Range,
  boundaryHour: number,
): number {
  const own = recordsOf(def, records)
  const opts = optsAt(range.to, boundaryHour)
  let longest = 0
  let run = 0

  for (const day of daysIn(range)) {
    if (!isTargetDay(def, day)) continue
    if (dayStatus(def, own, day, opts).achieved) {
      run += 1
      if (run > longest) longest = run
    } else {
      run = 0
    }
  }

  return longest
}

export function habitStats(
  snapshot: Snapshot,
  range: Range,
  opts: StreakOptions,
): HabitStat[] {
  const today = todayKey(opts.clock, opts.boundaryHour)
  const days = daysIn(range).filter((day) => day <= today)
  const at = optsAt(range.to, opts.boundaryHour)
  const stats: HabitStat[] = []

  for (const definition of countedDefinitions(snapshot)) {
    if (!isScored(definition)) continue
    const own = recordsOf(definition, snapshot.records)
    const floor = firstCountedDay(definition, own, opts.boundaryHour)
    let targetDays = 0
    let achievedDays = 0

    for (const day of days) {
      if (day < floor) continue
      if (!isTargetDay(definition, day)) continue
      targetDays += 1
      if (dayStatus(definition, own, day, at).achieved) achievedDays += 1
    }

    if (definition.archived && targetDays === 0) continue

    stats.push({
      definition,
      targetDays,
      achievedDays,
      percent: percentOf(achievedDays, targetDays),
      longestStreak: longestStreakIn(definition, own, range, opts.boundaryHour),
      currentStreak: computeStreak(definition, own, opts),
    })
  }

  return stats
}

export interface HeatCell {
  day: DayKey
  weekday: number
  count: number
  value: number
  achieved: boolean
  isTargetDay: boolean
  future: boolean
  counted: boolean
}

export interface HeatWeek {
  from: DayKey
  cells: (HeatCell | null)[]
}

export interface HeatTotals {
  targetDays: number
  achievedDays: number
  recordedDays: number
}

function slotOf(day: DayKey): number {
  return (weekdayOf(day) + 6) % 7
}

export function heatmapFor(
  def: Definition,
  records: LogRecord[],
  range: Range,
  opts: StreakOptions,
): HeatWeek[] {
  const { boundaryHour } = opts
  const today = todayKey(opts.clock, boundaryHour)
  const own = recordsOf(def, records)
  const totals = dailyTotals(def, own, boundaryHour)
  const floor = firstCountedDay(def, own, boundaryHour)
  const weeks: HeatWeek[] = []
  let current: HeatWeek | null = null

  for (const day of daysIn(range)) {
    const slot = slotOf(day)
    if (current === null || slot === 0) {
      current = { from: addDays(day, -slot), cells: [null, null, null, null, null, null, null] }
      weeks.push(current)
    }

    const status = statusFrom(def, day, totals, boundaryHour)
    const future = day > today
    current.cells[slot] = {
      day,
      weekday: weekdayOf(day),
      count: status.count,
      value: status.total,
      achieved: status.achieved,
      isTargetDay: status.isTargetDay,
      future,
      counted: !future && day >= floor && status.isTargetDay,
    }
  }

  return weeks
}

export function heatTotals(weeks: HeatWeek[]): HeatTotals {
  let targetDays = 0
  let achievedDays = 0
  let recordedDays = 0

  for (const week of weeks) {
    for (const cell of week.cells) {
      if (cell === null) continue
      if (cell.count > 0) recordedDays += 1
      if (!cell.counted) continue
      targetDays += 1
      if (cell.achieved) achievedDays += 1
    }
  }

  return { targetDays, achievedDays, recordedDays }
}

export interface WeekdayStat {
  weekday: number
  label: string
  targetDays: number
  achievedDays: number
  percent: number
}

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

export function weekdayStats(
  def: Definition,
  records: LogRecord[],
  range: Range,
  opts: StreakOptions,
): WeekdayStat[] {
  const { boundaryHour } = opts
  const today = todayKey(opts.clock, boundaryHour)
  const own = recordsOf(def, records)
  const totals = dailyTotals(def, own, boundaryHour)
  const floor = firstCountedDay(def, own, boundaryHour)
  const target = new Map<number, number>()
  const achieved = new Map<number, number>()

  for (const day of daysIn(range)) {
    if (day > today || day < floor) continue
    if (!isTargetDay(def, day)) continue
    const weekday = weekdayOf(day)
    target.set(weekday, (target.get(weekday) ?? 0) + 1)
    if (statusFrom(def, day, totals, boundaryHour).achieved) {
      achieved.set(weekday, (achieved.get(weekday) ?? 0) + 1)
    }
  }

  return WEEKDAY_ORDER.map((weekday) => {
    const targetDays = target.get(weekday) ?? 0
    const achievedDays = achieved.get(weekday) ?? 0
    return {
      weekday,
      label: weekdayLabel(weekday),
      targetDays,
      achievedDays,
      percent: percentOf(achievedDays, targetDays),
    }
  })
}

export function weakestWeekday(stats: WeekdayStat[]): WeekdayStat | null {
  let weakest: WeekdayStat | null = null
  for (const stat of stats) {
    if (stat.targetDays === 0) continue
    if (weakest === null || stat.percent < weakest.percent) weakest = stat
  }
  return weakest
}

export interface MeasurePoint {
  day: DayKey
  value: number
  count: number
  firstAt: string | null
  lastAt: string | null
}

export interface MeasureStat {
  definition: Definition
  aggregate: Aggregate
  days: MeasurePoint[]
  records: number
  recordedDays: number
  total: number
  average: number
  min: number | null
  max: number | null
  lastValue: number | null
  lastAt: string | null
  byHour: number[]
}

export function measureStats(
  snapshot: Snapshot,
  range: Range,
  opts: StreakOptions,
): MeasureStat[] {
  const { boundaryHour } = opts
  const today = todayKey(opts.clock, boundaryHour)
  const span = daysIn(range).filter((day) => day <= today)
  const stats: MeasureStat[] = []

  for (const definition of countedDefinitions(snapshot)) {
    if (isScored(definition)) continue

    const own = recordsOf(definition, snapshot.records)
    const totals = dailyTotals(definition, own, boundaryHour)
    const byHour = new Array<number>(24).fill(0)
    const days: MeasurePoint[] = []
    let records = 0
    let recordedDays = 0
    let total = 0
    let min: number | null = null
    let max: number | null = null
    let lastValue: number | null = null
    let lastAt: string | null = null

    for (const day of span) {
      const tally = totals.get(day)
      if (tally === undefined) {
        days.push({ day, value: 0, count: 0, firstAt: null, lastAt: null })
        continue
      }
      const value = tallyValue(definition, tally)
      days.push({
        day,
        value,
        count: tally.count,
        firstAt: tally.firstAt ?? null,
        lastAt: tally.lastAt ?? null,
      })
      records += tally.count
      recordedDays += 1
      total += value
      if (min === null || value < min) min = value
      if (max === null || value > max) max = value
      if (tally.lastAt !== undefined) {
        lastAt = tally.lastAt
        lastValue = tally.lastValue ?? null
      }
    }

    for (const record of own) {
      const day = logicalDay(record.at, boundaryHour)
      if (!holds(range, day) || day > today) continue
      const hour = new Date(record.at).getHours()
      byHour[hour] = (byHour[hour] ?? 0) + 1
    }

    if (definition.archived && records === 0) continue

    stats.push({
      definition,
      aggregate: aggregateOf(definition),
      days,
      records,
      recordedDays,
      total,
      average: recordedDays > 0 ? total / recordedDays : 0,
      min,
      max,
      lastValue,
      lastAt,
      byHour,
    })
  }

  return stats
}

export interface Summary {
  achievedPercent: number
  longestStreak: number
  totalTargetDays: number
  totalAchievedDays: number
}

export function summaryFor(stats: HabitStat[]): Summary {
  let totalTargetDays = 0
  let totalAchievedDays = 0
  let longestStreak = 0

  for (const stat of stats) {
    totalTargetDays += stat.targetDays
    totalAchievedDays += stat.achievedDays
    if (stat.longestStreak > longestStreak) longestStreak = stat.longestStreak
  }

  return {
    achievedPercent: percentOf(totalAchievedDays, totalTargetDays),
    longestStreak,
    totalTargetDays,
    totalAchievedDays,
  }
}

export interface OldestOpen {
  todo: Todo
  ageDays: number
}

export interface TodoStat {
  completed: number
  created: number
  open: number
  judged: number
  onTime: number
  late: number
  onTimePercent: number | null
  noDue: number
  leadTimeDays: number | null
  leadTimeSamples: number
  backfilled: number
  doneWithoutTime: number
  oldestOpen: OldestOpen | null
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]!
  return (sorted[mid - 1]! + sorted[mid]!) / 2
}

export function todoStats(
  snapshot: Snapshot,
  range: Range,
  opts: StreakOptions,
): TodoStat {
  const { boundaryHour } = opts
  const today = todayKey(opts.clock, boundaryHour)
  const leads: number[] = []
  let completed = 0
  let created = 0
  let open = 0
  let onTime = 0
  let late = 0
  let noDue = 0
  let backfilled = 0
  let doneWithoutTime = 0
  let oldest: Todo | null = null

  for (const todo of snapshot.todos) {
    if (todo.deleted) continue
    if (holds(range, logicalDay(todo.createdAt, boundaryHour))) created += 1

    if (todo.status !== 'done') {
      open += 1
      if (oldest === null || new Date(todo.createdAt) < new Date(oldest.createdAt)) {
        oldest = todo
      }
      continue
    }

    if (todo.doneAt === undefined) {
      doneWithoutTime += 1
      continue
    }

    const doneDay = logicalDay(todo.doneAt, boundaryHour)
    if (!holds(range, doneDay)) continue
    completed += 1

    if (todo.dueAt === undefined) noDue += 1
    else if (doneDay <= logicalDay(todo.dueAt, boundaryHour)) onTime += 1
    else late += 1

    const span = daysBetween(doneDay, logicalDay(todo.createdAt, boundaryHour))
    if (span < 0) backfilled += 1
    leads.push(Math.max(0, span))
  }

  const judged = onTime + late

  return {
    completed,
    created,
    open,
    judged,
    onTime,
    late,
    onTimePercent: judged > 0 ? percentOf(onTime, judged) : null,
    noDue,
    leadTimeDays: medianOf(leads),
    leadTimeSamples: leads.length,
    backfilled,
    doneWithoutTime,
    oldestOpen:
      oldest === null
        ? null
        : {
            todo: oldest,
            ageDays: Math.max(
              0,
              daysBetween(today, logicalDay(oldest.createdAt, boundaryHour)),
            ),
          },
  }
}

export interface JournalStat {
  diaryDays: number
  entries: number
  byKind: Record<JournalKind, number>
}

export function journalStats(
  snapshot: Snapshot,
  range: Range,
  boundaryHour: number,
): JournalStat {
  const diaryDays = new Set<DayKey>()
  const byKind: Record<JournalKind, number> = { diary: 0, meeting: 0, memo: 0 }
  let entries = 0

  for (const entry of snapshot.journal) {
    if (entry.deleted) continue
    const day = logicalDay(entry.at, boundaryHour)
    if (!holds(range, day)) continue
    entries += 1
    byKind[entry.kind] += 1
    if (entry.kind === 'diary') diaryDays.add(day)
  }

  return { diaryDays: diaryDays.size, entries, byKind }
}

export interface ReadingStat {
  pagesRead: number
  sessions: number
  finishedBooks: number
  byBook: { book: Book; pages: number }[]
}

export function readingStats(
  snapshot: Snapshot,
  range: Range,
  boundaryHour: number,
): ReadingStat {
  const goneDefIds = new Set(
    snapshot.definitions.filter((d) => d.deleted).map((d) => d.id),
  )
  const books = snapshot.books.filter((b) => !b.deleted && !goneDefIds.has(b.defId))
  const byDefId = new Map(books.map((b) => [b.defId, b]))
  const pagesByBook = new Map<string, number>()
  let pagesRead = 0
  let sessions = 0

  for (const record of snapshot.records) {
    if (record.deleted) continue
    const book = byDefId.get(record.defId)
    if (!book) continue
    if (!holds(range, logicalDay(record.at, boundaryHour))) continue
    pagesRead += record.value
    sessions += 1
    pagesByBook.set(book.id, (pagesByBook.get(book.id) ?? 0) + record.value)
  }

  const finishedBooks = books.filter(
    (b) => b.finishedAt !== undefined && holds(range, logicalDay(b.finishedAt, boundaryHour)),
  ).length

  const byBook = books
    .filter((b) => pagesByBook.has(b.id))
    .map((book) => ({ book, pages: pagesByBook.get(book.id) ?? 0 }))
    .sort((a, b) => b.pages - a.pages || a.book.title.localeCompare(b.book.title))

  return { pagesRead, sessions, finishedBooks, byBook }
}

export interface BookPace {
  book: Book
  read: number
  remaining: number | null
  perDay: number
  expectedDay: DayKey | null
}

export interface FinishedBook {
  book: Book
  days: number | null
}

export interface ReadingDetail {
  elapsedDays: number
  pagesPerDay: number
  ratings: number[]
  rated: number
  averageRating: number | null
  pace: BookPace[]
  finished: FinishedBook[]
}

export const RATING_STARS = 5

function starOf(rating: number | undefined): number | null {
  if (rating === undefined || !Number.isFinite(rating)) return null
  const star = Math.round(rating)
  return star >= 1 && star <= RATING_STARS ? star : null
}

export function readingDetail(
  snapshot: Snapshot,
  range: Range,
  opts: StreakOptions,
): ReadingDetail {
  const { boundaryHour } = opts
  const today = todayKey(opts.clock, boundaryHour)
  const goneDefIds = new Set(
    snapshot.definitions.filter((d) => d.deleted).map((d) => d.id),
  )
  const books = snapshot.books.filter((b) => !b.deleted && !goneDefIds.has(b.defId))
  const shelfDefIds = new Set(books.map((b) => b.defId))
  const elapsedDays = daysIn(range).filter((day) => day <= today).length

  const readByDef = new Map<string, number>()
  const inRangeByDef = new Map<string, number>()
  let pagesRead = 0

  for (const record of snapshot.records) {
    if (record.deleted || !shelfDefIds.has(record.defId)) continue
    readByDef.set(record.defId, (readByDef.get(record.defId) ?? 0) + record.value)
    if (!holds(range, logicalDay(record.at, boundaryHour))) continue
    inRangeByDef.set(record.defId, (inRangeByDef.get(record.defId) ?? 0) + record.value)
    pagesRead += record.value
  }

  const ratings = new Array<number>(RATING_STARS).fill(0)
  let rated = 0
  let ratingTotal = 0

  for (const book of books) {
    const star = starOf(book.rating)
    if (star === null) continue
    ratings[star - 1] = (ratings[star - 1] ?? 0) + 1
    rated += 1
    ratingTotal += star
  }

  const pace: BookPace[] = []
  const finished: FinishedBook[] = []

  for (const book of books) {
    if (book.status === 'reading') {
      const read = readByDef.get(book.defId) ?? 0
      const remaining =
        book.totalPages === undefined ? null : Math.max(0, book.totalPages - read)
      const perDay =
        elapsedDays > 0 ? (inRangeByDef.get(book.defId) ?? 0) / elapsedDays : 0
      const expectedDay =
        remaining === null
          ? null
          : remaining === 0
            ? today
            : perDay > 0
              ? addDays(today, Math.ceil(remaining / perDay))
              : null
      pace.push({ book, read, remaining, perDay, expectedDay })
    }

    const finishedAt = book.finishedAt
    if (finishedAt === undefined) continue
    const finishedDay = logicalDay(finishedAt, boundaryHour)
    if (!holds(range, finishedDay)) continue
    const startedAt = book.startedAt
    finished.push({
      book,
      days:
        startedAt === undefined
          ? null
          : Math.max(1, daysBetween(finishedDay, logicalDay(startedAt, boundaryHour)) + 1),
    })
  }

  const byTitle = (a: { book: Book }, b: { book: Book }) =>
    a.book.title.localeCompare(b.book.title)

  return {
    elapsedDays,
    pagesPerDay: elapsedDays > 0 ? pagesRead / elapsedDays : 0,
    ratings,
    rated,
    averageRating: rated > 0 ? ratingTotal / rated : null,
    pace: pace.sort(byTitle),
    finished: finished.sort(byTitle),
  }
}

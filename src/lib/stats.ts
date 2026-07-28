import type { Snapshot } from '../data/store'
import { fixedClock } from './clock'
import {
  addDays,
  dayKeyToDate,
  daysBetween,
  lastNDays,
  logicalDay,
  todayKey,
  type DayKey,
} from './day'
import { visibleDefinitions } from './select'
import { computeStreak, dayStatus, isTargetDay, type StreakOptions } from './streak'
import type { Book, Definition, JournalKind, LogRecord } from './types'

export type Period = 'week' | 'month' | 'year'

export interface Range {
  from: DayKey
  to: DayKey
}

function dayKey(year: number, month: number, day: number): DayKey {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function rangeFor(period: Period, today: DayKey): Range {
  const date = dayKeyToDate(today)
  const year = date.getFullYear()
  const month = date.getMonth() + 1

  if (period === 'week') {
    const from = addDays(today, -((date.getDay() + 6) % 7))
    return { from, to: addDays(from, 6) }
  }

  if (period === 'month') {
    const next = month === 12 ? dayKey(year + 1, 1, 1) : dayKey(year, month + 1, 1)
    return { from: dayKey(year, month, 1), to: addDays(next, -1) }
  }

  return { from: dayKey(year, 1, 1), to: dayKey(year, 12, 31) }
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

  return visibleDefinitions(snapshot).map((definition) => {
    const own = recordsOf(definition, snapshot.records)
    let targetDays = 0
    let achievedDays = 0

    for (const day of days) {
      if (!isTargetDay(definition, day)) continue
      targetDays += 1
      if (dayStatus(definition, own, day, at).achieved) achievedDays += 1
    }

    return {
      definition,
      targetDays,
      achievedDays,
      percent: percentOf(achievedDays, targetDays),
      longestStreak: longestStreakIn(definition, own, range, opts.boundaryHour),
      currentStreak: computeStreak(definition, own, opts),
    }
  })
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

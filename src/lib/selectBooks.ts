import type { Snapshot } from '../data/store'
import { dailyTotals } from './streak'
import type { Book, BookStatus, Definition, LogRecord } from './types'

export interface BookProgress {
  pagesRead: number
  totalPages: number | null
  percent: number
}

function ms(at: string): number {
  return new Date(at).getTime()
}

export function liveBooks(snapshot: Snapshot): Book[] {
  return snapshot.books
    .filter((b) => !b.deleted)
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt) || a.title.localeCompare(b.title))
}

export function booksByStatus(snapshot: Snapshot, status: BookStatus): Book[] {
  return liveBooks(snapshot).filter((b) => b.status === status)
}

export function bookDefinition(book: Book, snapshot: Snapshot): Definition | null {
  return snapshot.definitions.find((d) => d.id === book.defId && !d.deleted) ?? null
}

export function bookSessions(book: Book, snapshot: Snapshot): LogRecord[] {
  return snapshot.records
    .filter((r) => !r.deleted && r.defId === book.defId)
    .sort(
      (a, b) =>
        ms(b.at) - ms(a.at) ||
        ms(b.createdAt) - ms(a.createdAt) ||
        b.id.localeCompare(a.id),
    )
}

export function pagesRead(book: Book, snapshot: Snapshot): number {
  const def = bookDefinition(book, snapshot)
  if (def === null) return 0
  const totals = dailyTotals(def, snapshot.records, snapshot.settings.dayBoundaryHour)
  let sum = 0
  for (const tally of totals.values()) sum += tally.sum
  return sum
}

export function totalPagesOf(book: Book): number | null {
  return book.totalPages !== undefined && book.totalPages > 0 ? book.totalPages : null
}

export function bookProgress(book: Book, snapshot: Snapshot): BookProgress {
  const read = pagesRead(book, snapshot)
  const totalPages = totalPagesOf(book)
  const percent =
    totalPages === null ? 0 : Math.max(0, Math.min(100, (read / totalPages) * 100))
  return { pagesRead: read, totalPages, percent }
}

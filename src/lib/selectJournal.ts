import { addDays, logicalDay, weekdayLabel, weekdayOf, type DayKey } from './day'
import type { Snapshot } from '../data/store'
import type { Journal, JournalKind } from './types'

const PREVIEW_MAX = 60
const ELLIPSIS = '…'

const KIND_LABELS: Record<JournalKind, string> = {
  diary: '일기',
  meeting: '회의록',
  memo: '메모',
}

export const JOURNAL_KINDS: JournalKind[] = ['diary', 'meeting', 'memo']

export function journalKindLabel(kind: JournalKind): string {
  return KIND_LABELS[kind]
}

function timeOf(at: string): number {
  const ms = new Date(at).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

function newestFirst(a: Journal, b: Journal): number {
  const at = timeOf(b.at) - timeOf(a.at)
  if (at !== 0) return at
  const created = timeOf(b.createdAt) - timeOf(a.createdAt)
  if (created !== 0) return created
  return a.id.localeCompare(b.id)
}

export function liveJournal(snapshot: Snapshot): Journal[] {
  return snapshot.journal.filter((e) => !e.deleted)
}

export function journalTimeline(
  snapshot: Snapshot,
  filter?: JournalKind[] | undefined,
): Journal[] {
  const kinds = filter && filter.length > 0 ? new Set<JournalKind>(filter) : null
  return liveJournal(snapshot)
    .filter((e) => kinds === null || kinds.has(e.kind))
    .sort(newestFirst)
}

export function journalByProject(snapshot: Snapshot, projectId: string): Journal[] {
  return liveJournal(snapshot)
    .filter((e) => e.projectId === projectId)
    .sort(newestFirst)
}

export function journalPreview(entry: Journal, max: number = PREVIEW_MAX): string {
  const line = entry.body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!line) return ''
  return line.length > max ? `${line.slice(0, max)}${ELLIPSIS}` : line
}

export interface JournalDayGroup {
  day: DayKey
  entries: Journal[]
}

export function groupByDay(entries: Journal[], boundaryHour: number): JournalDayGroup[] {
  const groups: JournalDayGroup[] = []
  let current: JournalDayGroup | null = null
  for (const entry of entries) {
    const day = logicalDay(entry.at, boundaryHour)
    if (current === null || current.day !== day) {
      current = { day, entries: [] }
      groups.push(current)
    }
    current.entries.push(entry)
  }
  return groups
}

export function journalDayLabel(day: DayKey, today: DayKey): string {
  if (day === today) return '오늘'
  if (day === addDays(today, -1)) return '어제'
  return `${day} (${weekdayLabel(weekdayOf(day))})`
}

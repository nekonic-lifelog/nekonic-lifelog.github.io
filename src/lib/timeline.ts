import { addDays, dayKeyToDate, daysBetween, lastNDays, logicalDay, type DayKey } from './day'
import { DEFAULT_SETTINGS, type Project } from './types'

export const TIMELINE_MIN_DAYS = 14
export const TIMELINE_PAD_DAYS = 2
export const TIMELINE_MIN_WIDTH_PERCENT = 1.5
export const TIMELINE_MAX_TICKS = 7

const DEFAULT_BOUNDARY_HOUR = DEFAULT_SETTINGS.dayBoundaryHour

export interface TimelineRange {
  from: DayKey
  to: DayKey
  days: DayKey[]
}

export interface TimelineBar {
  project: Project
  startDay: DayKey
  endDay: DayKey
  offsetPercent: number
  widthPercent: number
  clippedStart: boolean
  clippedEnd: boolean
  overdue: boolean
  undated: boolean
}

export interface TimelineTick {
  day: DayKey
  percent: number
  label: string
}

interface Span {
  start: DayKey
  end: DayKey
}

function floor3(value: number): number {
  return Math.floor(value * 1000) / 1000
}

function dayOf(at: string | undefined, boundaryHour: number): DayKey | null {
  if (typeof at !== 'string' || at.trim() === '') return null
  const ms = Date.parse(at)
  if (Number.isNaN(ms)) return null
  return logicalDay(ms, boundaryHour)
}

export function projectStartDay(
  project: Project,
  boundaryHour: number = DEFAULT_BOUNDARY_HOUR,
): DayKey | null {
  return dayOf(project.startAt, boundaryHour) ?? dayOf(project.createdAt, boundaryHour)
}

export function projectEndDay(
  project: Project,
  boundaryHour: number = DEFAULT_BOUNDARY_HOUR,
): DayKey | null {
  return dayOf(project.dueAt, boundaryHour)
}

function spanOf(project: Project, boundaryHour: number): Span | null {
  const end = projectEndDay(project, boundaryHour)
  if (!end) return null
  const start = projectStartDay(project, boundaryHour) ?? end
  return { start: start > end ? end : start, end }
}

export function timelineRange(
  projects: Project[],
  today: DayKey,
  minDays: number = TIMELINE_MIN_DAYS,
  boundaryHour: number = DEFAULT_BOUNDARY_HOUR,
): TimelineRange {
  let min = today
  let max = today
  for (const project of projects) {
    const span = spanOf(project, boundaryHour)
    if (!span) continue
    if (span.start < min) min = span.start
    if (span.end > max) max = span.end
  }

  const from = addDays(min, -TIMELINE_PAD_DAYS)
  let to = addDays(max, TIMELINE_PAD_DAYS)
  const want = Math.max(1, Math.trunc(minDays))
  if (daysBetween(to, from) + 1 < want) to = addDays(from, want - 1)

  return { from, to, days: lastNDays(to, daysBetween(to, from) + 1) }
}

function undatedBar(project: Project, boundaryHour: number): TimelineBar {
  const start = projectStartDay(project, boundaryHour) ?? ''
  return {
    project,
    startDay: start,
    endDay: start,
    offsetPercent: 0,
    widthPercent: 0,
    clippedStart: false,
    clippedEnd: false,
    overdue: false,
    undated: true,
  }
}

export function barFor(
  project: Project,
  range: TimelineRange,
  today: DayKey,
  boundaryHour: number = DEFAULT_BOUNDARY_HOUR,
): TimelineBar | null {
  const span = spanOf(project, boundaryHour)
  if (!span) return null
  if (span.end < range.from || span.start > range.to) return null

  const total = Math.max(1, range.days.length)
  const shownStart = span.start < range.from ? range.from : span.start
  const shownEnd = span.end > range.to ? range.to : span.end
  const index = daysBetween(shownStart, range.from)
  const covered = daysBetween(shownEnd, shownStart) + 1

  let width = Math.min(100, Math.max(TIMELINE_MIN_WIDTH_PERCENT, (covered / total) * 100))
  let offset = Math.max(0, (index / total) * 100)
  if (offset + width > 100) offset = Math.max(0, 100 - width)
  if (width > 100 - offset) width = 100 - offset

  return {
    project,
    startDay: span.start,
    endDay: span.end,
    offsetPercent: floor3(offset),
    widthPercent: floor3(width),
    clippedStart: span.start < range.from,
    clippedEnd: span.end > range.to,
    overdue: span.end < today && project.status !== 'done',
    undated: false,
  }
}

export function timelineBars(
  projects: Project[],
  range: TimelineRange,
  today: DayKey,
  boundaryHour: number = DEFAULT_BOUNDARY_HOUR,
): TimelineBar[] {
  const bars: TimelineBar[] = []
  for (const project of projects) {
    if (!projectEndDay(project, boundaryHour)) {
      bars.push(undatedBar(project, boundaryHour))
      continue
    }
    const bar = barFor(project, range, today, boundaryHour)
    if (bar) bars.push(bar)
  }
  return bars
}

export function todayPercent(range: TimelineRange, today: DayKey): number {
  const total = Math.max(1, range.days.length)
  const index = daysBetween(today, range.from)
  const raw = ((index + 0.5) / total) * 100
  return floor3(Math.min(100, Math.max(0, raw)))
}

function tickLabel(day: DayKey): string {
  const d = dayKeyToDate(day)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function axisTicks(
  range: TimelineRange,
  maxTicks: number = TIMELINE_MAX_TICKS,
): TimelineTick[] {
  const total = range.days.length
  if (total === 0) return []
  const limit = Math.max(1, Math.trunc(maxTicks))
  const step = Math.max(1, Math.ceil(total / limit))

  const ticks: TimelineTick[] = []
  for (let i = 0; i < total; i += step) {
    const day = range.days[i]
    if (day === undefined) continue
    ticks.push({ day, percent: floor3((i / total) * 100), label: tickLabel(day) })
  }
  return ticks
}

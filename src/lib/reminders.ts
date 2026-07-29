import type { Snapshot } from '../data/store'
import type { Settings, Todo } from './types'

export type ReminderChannel = 'discord' | 'email'

export interface RecurringReminder {
  id: string
  at: string
  days?: number[] | undefined
  label: string
  channel: ReminderChannel
}

export interface EventReminder {
  id: string
  at: string
  label: string
  offsets: number[]
  channel: ReminderChannel
}

export interface ReminderFile {
  tz: string
  recurring: RecurringReminder[]
  events: EventReminder[]
}

export interface ReminderInput {
  snapshot: Snapshot
  settings: Settings
  now: number
}

export const DEFAULT_TZ = 'Asia/Seoul'
export const DEFAULT_OFFSETS: number[] = [2880, 1440, 120, 60]
export const MASKED_PROJECT_LABEL = '업무'
export const GRACE_MS = 86_400_000
export const REMINDER_DIR = 'meta/reminders'

const FALLBACK_LABEL = '알림'
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const MINUTE_MS = 60_000
const REMINDER_PATH_RE = /^\/?meta\/reminders\/([^/]+)\.json$/
const OFFSET_ZONE_RE = /^[+-]/

export function reminderPathFor(deviceId: string): string {
  return `${REMINDER_DIR}/${deviceId}.json`
}

export function reminderDeviceIdFrom(path: string): string | null {
  const found = REMINDER_PATH_RE.exec(path)
  const id = found?.[1]
  return id === undefined || id === '' ? null : id
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function zoneOffsetMinutes(tz: string, ms: number): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const found: Record<string, string> = {}
  for (const part of fmt.formatToParts(new Date(ms))) found[part.type] = part.value
  const asUtc = Date.UTC(
    Number(found['year']),
    Number(found['month']) - 1,
    Number(found['day']),
    Number(found['hour']),
    Number(found['minute']),
    Number(found['second']),
  )
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MINUTE_MS)
}

export function isKnownTimeZone(tz: string): boolean {
  if (typeof tz !== 'string') return false
  if (tz.trim() === '' || tz.trim() !== tz) return false
  if (OFFSET_ZONE_RE.test(tz)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function listTimeZones(): string[] {
  try {
    const supported = Intl.supportedValuesOf?.('timeZone')
    return Array.isArray(supported) ? [...supported] : []
  } catch {
    return []
  }
}

export function emptyReminderFile(tz: string): ReminderFile {
  return { tz: isKnownTimeZone(tz) ? tz : DEFAULT_TZ, recurring: [], events: [] }
}

export function readReminderTz(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_TZ
    const tz = (parsed as Record<string, unknown>)['tz']
    return typeof tz === 'string' && isKnownTimeZone(tz) ? tz : DEFAULT_TZ
  } catch {
    return DEFAULT_TZ
  }
}

function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
}

export function isoInZone(ms: number, tz: string): string {
  const minutes = zoneOffsetMinutes(tz, ms)
  const shifted = new Date(ms + minutes * MINUTE_MS)
  const date = `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
  const time = `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}:${pad2(shifted.getUTCSeconds())}`
  return `${date}T${time}${offsetLabel(minutes)}`
}

function cleanOffsets(raw: number[] | undefined): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_OFFSETS]
  const kept = new Set<number>()
  for (const value of raw) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const minutes = Math.trunc(value)
    if (minutes <= 0) continue
    kept.add(minutes)
  }
  return [...kept].sort((a, b) => b - a)
}

function cleanDays(raw: number[] | undefined): number[] | null {
  if (!Array.isArray(raw)) return null
  const kept = new Set<number>()
  for (const value of raw) {
    if (typeof value !== 'number' || !Number.isInteger(value)) continue
    if (value < 0 || value > 6) continue
    kept.add(value)
  }
  if (kept.size === 0) return null
  return [...kept].sort((a, b) => a - b)
}

function channelOf(raw: unknown, fallback: ReminderChannel): ReminderChannel {
  return raw === 'discord' || raw === 'email' ? raw : fallback
}

function labelOf(todo: Todo, mask: boolean): string {
  if (todo.projectId !== undefined && todo.projectId !== '' && mask) {
    return MASKED_PROJECT_LABEL
  }
  const title = todo.title.trim()
  return title === '' ? FALLBACK_LABEL : title
}

function lastFireAt(at: number, offsets: number[]): number {
  let smallest: number | null = null
  for (const minutes of offsets) {
    if (smallest === null || minutes < smallest) smallest = minutes
  }
  return smallest === null ? at : at - smallest * MINUTE_MS
}

function stillLive(at: number, offsets: number[], now: number): boolean {
  return now - lastFireAt(at, offsets) < GRACE_MS
}

function byAtThenId(a: EventReminder, b: EventReminder): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function buildRecurring(
  raw: RecurringReminder[] | undefined,
  fallback: ReminderChannel,
): RecurringReminder[] {
  if (!Array.isArray(raw)) return []
  const out: RecurringReminder[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    if (typeof entry.id !== 'string' || entry.id === '') continue
    if (typeof entry.at !== 'string' || !TIME_RE.test(entry.at)) continue
    const label = typeof entry.label === 'string' ? entry.label.trim() : ''
    const days = cleanDays(entry.days)
    const made: RecurringReminder = {
      id: entry.id,
      at: entry.at,
      label: label === '' ? FALLBACK_LABEL : label,
      channel: channelOf(entry.channel, fallback),
    }
    out.push(days === null ? made : { ...made, days })
  }
  return out
}

export function buildReminderFile(input: ReminderInput): ReminderFile {
  const settings = input.settings
  const tz = isKnownTimeZone(settings.tz ?? '') ? settings.tz : DEFAULT_TZ
  const channel = channelOf(settings.notifyChannel, 'discord')
  const offsets = cleanOffsets(settings.defaultOffsets)
  const mask = settings.maskProjectLabels !== false

  const events: EventReminder[] = []
  for (const todo of input.snapshot.todos) {
    if (todo.deleted) continue
    if (todo.status === 'done') continue
    if (todo.dueAt === undefined || todo.dueAt === '') continue
    const at = Date.parse(todo.dueAt)
    if (Number.isNaN(at)) continue
    if (!stillLive(at, offsets, input.now)) continue
    events.push({
      id: todo.id,
      at: isoInZone(at, tz),
      label: labelOf(todo, mask),
      offsets: [...offsets],
      channel,
    })
  }
  events.sort(byAtThenId)

  return { tz, recurring: buildRecurring(settings.recurring, channel), events }
}

export function serializeReminderFile(file: ReminderFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

function canonical(value: unknown): string {
  if (value === undefined || value === null) return 'null'
  if (Array.isArray(value)) {
    return `[${value.map(canonical).sort().join(',')}]`
  }
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

export function sameReminderFile(a: ReminderFile, b: ReminderFile): boolean {
  return canonical(a) === canonical(b)
}

export const FALLBACK_DUE_TIME = '12:00'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^(\d{1,2}):(\d{2})/

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function parseTime(raw: string): { hour: number; minute: number } | null {
  const found = TIME_RE.exec(raw)
  if (!found) return null
  const hour = Number(found[1])
  const minute = Number(found[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

function asDate(dueAt: string | undefined): Date | null {
  if (typeof dueAt !== 'string' || dueAt.trim() === '') return null
  const ms = Date.parse(dueAt)
  if (Number.isNaN(ms)) return null
  return new Date(ms)
}

export function toDueAt(date: string, time?: string | undefined): string | undefined {
  if (typeof date !== 'string') return undefined
  const day = DATE_RE.exec(date.trim())
  if (!day) return undefined

  const year = Number(day[1])
  const month = Number(day[2])
  const dayOfMonth = Number(day[3])
  if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31) return undefined

  const probe = new Date(year, month - 1, dayOfMonth, 12, 0, 0, 0)
  if (Number.isNaN(probe.getTime())) return undefined
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== dayOfMonth
  ) {
    return undefined
  }

  const raw = typeof time === 'string' ? time.trim() : ''
  const clock = parseTime(raw) ?? parseTime(FALLBACK_DUE_TIME)
  if (!clock) return undefined

  const made = new Date(year, month - 1, dayOfMonth, clock.hour, clock.minute, 0, 0)
  if (Number.isNaN(made.getTime())) return undefined
  return made.toISOString()
}

export function dueDateValue(dueAt: string | undefined): string {
  const d = asDate(dueAt)
  if (!d) return ''
  return `${String(d.getFullYear()).padStart(4, '0')}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function dueTimeValue(dueAt: string | undefined): string {
  const d = asDate(dueAt)
  if (!d) return ''
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function formatDueLabel(dueAt: string): string {
  const d = asDate(dueAt)
  if (!d) return typeof dueAt === 'string' ? dueAt : ''
  return `${dueDateValue(dueAt)} ${dueTimeValue(dueAt)}`
}

export function ddayLabel(remaining: number): string {
  if (remaining === 0) return '오늘'
  return remaining > 0 ? `${remaining}일 남음` : `${-remaining}일 지남`
}

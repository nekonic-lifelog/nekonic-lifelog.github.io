import type { TableName } from '../data/store'
import type { Base } from '../lib/types'

export class PathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathError'
  }
}

export interface ParsedPath {
  table: TableName
  deviceId?: string
  entryId?: string
  month?: string
  day?: string
}

export interface PathGroup {
  table: TableName
  rows: Base[]
}

const EXT = '.enc'

export const TABLE_ORDER: readonly TableName[] = [
  'definitions',
  'records',
  'todos',
  'projects',
  'books',
  'journal',
]

const DIRS = {
  definitions: 'defs',
  records: 'records',
  todos: 'todos',
  projects: 'projects',
  books: 'books',
  journal: 'journal',
} as const satisfies Record<TableName, string>

const TABLE_OF_DIR = new Map<string, TableName>(
  TABLE_ORDER.map((table) => [DIRS[table], table]),
)

const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/
const DAY_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/
const LEADING_DAY_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])/
const NAME_RE = /^[A-Za-z0-9_-]+$/

export function dayOf(row: Base): string {
  const m = LEADING_DAY_RE.exec(row.createdAt)
  if (!m) {
    throw new PathError(`생성 시각에서 날짜를 읽을 수 없습니다: ${String(row.createdAt)}`)
  }
  return m[0]
}

export function monthOf(row: Base): string {
  return dayOf(row).slice(0, 7)
}

function segment(value: string, what: string): string {
  if (!NAME_RE.test(value)) {
    throw new PathError(`파일 이름으로 쓸 수 없는 ${what}입니다: ${String(value)}`)
  }
  return value
}

export function pathFor(table: TableName, row: Base): string {
  if (table === 'journal') {
    return `/journal/${monthOf(row)}/${segment(row.id, 'id')}${EXT}`
  }
  const device = segment(row.deviceId, 'deviceId')
  if (table === 'records') {
    const day = dayOf(row)
    return `/records/${day.slice(0, 7)}/${day}/${device}${EXT}`
  }
  return `/${DIRS[table]}/${device}${EXT}`
}

export function parsePath(path: string): ParsedPath | null {
  if (!path.startsWith('/')) return null
  const parts = path.slice(1).split('/')
  const table = TABLE_OF_DIR.get(parts[0] ?? '')
  if (!table) return null

  const last = parts[parts.length - 1]
  if (last === undefined || !last.endsWith(EXT)) return null
  const name = last.slice(0, last.length - EXT.length)
  if (!NAME_RE.test(name)) return null

  if (table === 'journal') {
    if (parts.length !== 3) return null
    const month = parts[1] ?? ''
    if (!MONTH_RE.test(month)) return null
    return { table, entryId: name, month }
  }

  if (table === 'records') {
    if (parts.length !== 4) return null
    const month = parts[1] ?? ''
    const day = parts[2] ?? ''
    if (!MONTH_RE.test(month)) return null
    if (!DAY_RE.test(day)) return null
    if (day.slice(0, 7) !== month) return null
    return { table, deviceId: name, month, day }
  }

  if (parts.length !== 2) return null
  return { table, deviceId: name }
}

export function isOwnPath(path: string, deviceId: string): boolean {
  const parsed = parsePath(path)
  return parsed !== null && parsed.deviceId === deviceId
}

export function monthOfPath(path: string): string | null {
  return parsePath(path)?.month ?? null
}

export function groupByPath(
  rows: Partial<Record<TableName, Base[]>>,
): Map<string, PathGroup> {
  const out = new Map<string, PathGroup>()
  for (const table of TABLE_ORDER) {
    const list = rows[table]
    if (!list) continue
    for (const row of list) {
      const path = pathFor(table, row)
      const bucket = out.get(path)
      if (bucket) bucket.rows.push(row)
      else out.set(path, { table, rows: [row] })
    }
  }
  return out
}

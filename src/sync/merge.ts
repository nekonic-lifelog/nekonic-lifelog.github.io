import type { Snapshot } from '../data/store'
import type { Base } from '../lib/types'

function instantOf(row: Base): number {
  const ms = Date.parse(row.updatedAt)
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

function canonical(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

export function winnerOf<T extends Base>(a: T, b: T): T {
  const ta = instantOf(a)
  const tb = instantOf(b)
  if (ta !== tb) return ta > tb ? a : b
  if (a.deleted !== b.deleted) return a.deleted ? a : b
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? a : b
  const ka = canonical(a)
  const kb = canonical(b)
  if (ka !== kb) return ka > kb ? a : b
  return a
}

function byId(a: Base, b: Base): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function mergeRows<T extends Base>(groups: T[][]): T[] {
  const best = new Map<string, T>()
  for (const group of groups) {
    for (const row of group) {
      const prev = best.get(row.id)
      best.set(row.id, prev === undefined ? row : winnerOf(row, prev))
    }
  }
  return [...best.values()].sort(byId)
}

export function ownRows<T extends Base>(rows: T[], deviceId: string): T[] {
  return rows.filter((row) => row.deviceId === deviceId)
}

export function liveRows<T extends Base>(rows: T[]): T[] {
  return rows.filter((row) => !row.deleted)
}

export function mergeSnapshots(local: Snapshot, remote: Partial<Snapshot>): Snapshot {
  return {
    definitions: mergeRows([local.definitions, remote.definitions ?? []]),
    records: mergeRows([local.records, remote.records ?? []]),
    todos: mergeRows([local.todos, remote.todos ?? []]),
    projects: mergeRows([local.projects, remote.projects ?? []]),
    books: mergeRows([local.books, remote.books ?? []]),
    journal: mergeRows([local.journal, remote.journal ?? []]),
    settings: local.settings,
  }
}

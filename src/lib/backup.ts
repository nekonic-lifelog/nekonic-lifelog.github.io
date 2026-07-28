import type { Clock } from './clock'
import { DEFAULT_SETTINGS, SCHEMA_VERSION, type Settings } from './types'
import type { Snapshot } from '../data/store'

export interface BackupFile {
  v: number
  exportedAt: string
  data: Snapshot
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

const MIGRATIONS: Record<number, (file: BackupFile) => BackupFile> = {}

export function buildBackup(snapshot: Snapshot, clock: Clock): BackupFile {
  return {
    v: SCHEMA_VERSION,
    exportedAt: new Date(clock.now()).toISOString(),
    data: snapshot,
  }
}

export function serializeBackup(snapshot: Snapshot, clock: Clock): string {
  return JSON.stringify(buildBackup(snapshot, clock), null, 2)
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function requireRows(data: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const rows = data[key]
  if (!Array.isArray(rows)) throw new BackupError(`백업 파일에 ${key} 배열이 없습니다.`)
  rows.forEach((row, i) => {
    if (!isObject(row) || typeof row['id'] !== 'string') {
      throw new BackupError(`${key}[${i}] 항목에 id가 없습니다. 손상된 파일입니다.`)
    }
  })
  return rows as Record<string, unknown>[]
}

function optionalRows(
  data: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  if (data[key] === undefined || data[key] === null) return []
  return requireRows(data, key)
}

export function parseBackup(text: string): BackupFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BackupError('JSON으로 읽을 수 없는 파일입니다.')
  }
  if (!isObject(raw)) throw new BackupError('백업 파일의 최상위가 객체가 아닙니다.')

  const v = raw['v']
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new BackupError('백업 파일에 유효한 스키마 버전(v)이 없습니다.')
  }
  if (v > SCHEMA_VERSION) {
    throw new BackupError(
      `이 백업은 스키마 v${v}입니다. 현재 앱은 v${SCHEMA_VERSION}까지 읽을 수 있습니다. ` +
        '앱을 최신 버전으로 갱신한 뒤 다시 시도하세요.',
    )
  }
  if (!isObject(raw['data'])) throw new BackupError('백업 파일에 data 객체가 없습니다.')

  const data = raw['data']
  requireRows(data, 'definitions')
  requireRows(data, 'records')
  requireRows(data, 'todos')
  const projects = optionalRows(data, 'projects')
  const books = optionalRows(data, 'books')
  const journal = optionalRows(data, 'journal')

  const settings = isObject(data['settings']) ? data['settings'] : {}
  const file: BackupFile = {
    v,
    exportedAt: typeof raw['exportedAt'] === 'string' ? raw['exportedAt'] : '',
    data: {
      definitions: data['definitions'] as Snapshot['definitions'],
      records: data['records'] as Snapshot['records'],
      todos: data['todos'] as Snapshot['todos'],
      projects: projects as unknown as Snapshot['projects'],
      books: books as unknown as Snapshot['books'],
      journal: journal as unknown as Snapshot['journal'],
      settings: { ...DEFAULT_SETTINGS, ...(settings as Partial<Settings>) },
    },
  }

  return migrate(file)
}

export function migrate(file: BackupFile): BackupFile {
  let current = file
  while (current.v < SCHEMA_VERSION) {
    const step = MIGRATIONS[current.v]
    if (!step) {
      throw new BackupError(
        `스키마 v${current.v}에서 v${current.v + 1}로 올리는 마이그레이션이 없습니다.`,
      )
    }
    current = step(current)
  }
  return current
}

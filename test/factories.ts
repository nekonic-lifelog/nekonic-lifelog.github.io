import {
  SCHEMA_VERSION,
  type Book,
  type Definition,
  type Journal,
  type LogRecord,
  type Project,
  type TargetPoint,
  type Todo,
} from '../src/lib/types'

let seq = 0
const nextId = () => `id-${++seq}`

export function resetIds() {
  seq = 0
}

const DEVICE = 'test-device'

export function makeDef(overrides: Partial<Definition> = {}): Definition {
  const createdAt = overrides.createdAt ?? '2026-03-01T12:00:00+09:00'
  return {
    id: overrides.id ?? nextId(),
    v: SCHEMA_VERSION,
    createdAt,
    deviceId: DEVICE,
    updatedAt: createdAt,
    deleted: false,
    kind: 'check',
    name: '아침 약',
    targetHistory: [],
    order: 0,
    hidden: false,
    archived: false,
    ...overrides,
  }
}

export function makeQuantityDef(
  targetHistory: TargetPoint[],
  overrides: Partial<Definition> = {},
): Definition {
  return makeDef({
    kind: 'quantity',
    name: '물',
    unit: 'ml',
    targetHistory,
    ...overrides,
  })
}

export function makeRecord(
  defId: string,
  at: string,
  value = 1,
  overrides: Partial<LogRecord> = {},
): LogRecord {
  return {
    id: overrides.id ?? nextId(),
    v: SCHEMA_VERSION,
    createdAt: overrides.createdAt ?? at,
    deviceId: DEVICE,
    updatedAt: overrides.updatedAt ?? at,
    deleted: false,
    defId,
    at,
    value,
    ...overrides,
  }
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  const createdAt = overrides.createdAt ?? '2026-03-01T12:00:00+09:00'
  return {
    id: overrides.id ?? nextId(),
    v: SCHEMA_VERSION,
    createdAt,
    deviceId: DEVICE,
    updatedAt: createdAt,
    deleted: false,
    name: '이사 준비',
    status: 'active',
    order: 0,
    ...overrides,
  }
}

export function makeTodo(overrides: Partial<Todo> = {}): Todo {
  const createdAt = overrides.createdAt ?? '2026-03-01T12:00:00+09:00'
  return {
    id: overrides.id ?? nextId(),
    v: SCHEMA_VERSION,
    createdAt,
    deviceId: DEVICE,
    updatedAt: createdAt,
    deleted: false,
    title: '장보기',
    status: 'todo',
    pinned: false,
    ...overrides,
  }
}

export function makeBook(overrides: Partial<Book> = {}): Book {
  const createdAt = overrides.createdAt ?? '2026-03-01T12:00:00+09:00'
  return {
    id: overrides.id ?? nextId(),
    v: SCHEMA_VERSION,
    createdAt,
    deviceId: DEVICE,
    updatedAt: createdAt,
    deleted: false,
    defId: overrides.defId ?? nextId(),
    title: '토지',
    status: 'reading',
    ...overrides,
  }
}

export function makeJournal(overrides: Partial<Journal> = {}): Journal {
  const createdAt = overrides.createdAt ?? '2026-03-01T12:00:00+09:00'
  return {
    id: overrides.id ?? nextId(),
    v: SCHEMA_VERSION,
    createdAt,
    deviceId: DEVICE,
    updatedAt: createdAt,
    deleted: false,
    kind: 'diary',
    at: overrides.at ?? createdAt,
    body: '오늘은 비가 왔다.',
    ...overrides,
  }
}

export function dailyRecords(
  defId: string,
  days: string[],
  value = 1,
  timeOfDay = '09:00:00',
): LogRecord[] {
  return days.map((d) => makeRecord(defId, `${d}T${timeOfDay}+09:00`, value))
}

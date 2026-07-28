import { SCHEMA_VERSION, type Definition, type LogRecord, type TargetPoint } from '../src/lib/types'

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

export function dailyRecords(
  defId: string,
  days: string[],
  value = 1,
  timeOfDay = '09:00:00',
): LogRecord[] {
  return days.map((d) => makeRecord(defId, `${d}T${timeOfDay}+09:00`, value))
}

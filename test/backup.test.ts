import { beforeEach, describe, expect, it } from 'vitest'
import { BackupError, buildBackup, parseBackup, serializeBackup } from '../src/lib/backup'
import { fixedClock } from '../src/lib/clock'
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../src/lib/types'
import type { Snapshot } from '../src/data/store'
import { dailyRecords, makeDef, resetIds } from './factories'

const clock = fixedClock('2026-03-12T20:00:00+09:00')

function sampleSnapshot(): Snapshot {
  const def = makeDef({ name: '아침 약' })
  return {
    definitions: [def],
    records: dailyRecords(def.id, ['2026-03-10', '2026-03-11']),
    todos: [],
    settings: { dayBoundaryHour: 4 },
  }
}

beforeEach(resetIds)

describe('내보내기', () => {
  it('최상위에 v와 exportedAt을 담는다', () => {
    const file = buildBackup(sampleSnapshot(), clock)
    expect(file.v).toBe(SCHEMA_VERSION)
    expect(file.exportedAt).toBe('2026-03-12T11:00:00.000Z')
    expect(file.data.definitions).toHaveLength(1)
  })

  it('내보낸 것을 그대로 다시 읽을 수 있다', () => {
    const snapshot = sampleSnapshot()
    const parsed = parseBackup(serializeBackup(snapshot, clock))
    expect(parsed.data).toEqual(snapshot)
  })
})

describe('불러오기 — 버전 판정', () => {
  const withVersion = (v: unknown) =>
    JSON.stringify({
      v,
      exportedAt: '2026-03-12T11:00:00.000Z',
      data: { definitions: [], records: [], todos: [], settings: {} },
    })

  it('현재 버전은 그대로 통과한다', () => {
    expect(parseBackup(withVersion(SCHEMA_VERSION)).v).toBe(SCHEMA_VERSION)
  })

  it('현재보다 높은 버전은 거부하고 이유를 말한다', () => {
    expect(() => parseBackup(withVersion(SCHEMA_VERSION + 1))).toThrow(BackupError)
    expect(() => parseBackup(withVersion(SCHEMA_VERSION + 1))).toThrow(/최신 버전으로 갱신/)
  })

  it('v가 없거나 숫자가 아니면 거부한다', () => {
    expect(() => parseBackup(withVersion(undefined))).toThrow(/스키마 버전/)
    expect(() => parseBackup(withVersion('1'))).toThrow(/스키마 버전/)
    expect(() => parseBackup(withVersion(0))).toThrow(/스키마 버전/)
  })
})

describe('불러오기 — 형식 검사', () => {
  it('JSON이 아니면 거부한다', () => {
    expect(() => parseBackup('이건 JSON이 아니다')).toThrow(/JSON으로 읽을 수 없는/)
  })

  it('최상위가 배열이면 거부한다', () => {
    expect(() => parseBackup('[]')).toThrow(/최상위가 객체가 아닙니다/)
  })

  it('data가 없으면 거부한다', () => {
    expect(() => parseBackup(JSON.stringify({ v: 1 }))).toThrow(/data 객체가 없습니다/)
  })

  it('테이블 배열이 빠지면 어느 것인지 알려준다', () => {
    const raw = JSON.stringify({
      v: 1,
      data: { definitions: [], records: [] },
    })
    expect(() => parseBackup(raw)).toThrow(/todos 배열이 없습니다/)
  })

  it('id 없는 행이 섞이면 위치를 알려준다', () => {
    const raw = JSON.stringify({
      v: 1,
      data: {
        definitions: [{ id: 'a' }, { name: 'id가 없다' }],
        records: [],
        todos: [],
      },
    })
    expect(() => parseBackup(raw)).toThrow(/definitions\[1\]/)
  })

  it('settings가 비어 있으면 기본값으로 채운다', () => {
    const raw = JSON.stringify({
      v: 1,
      data: { definitions: [], records: [], todos: [] },
    })
    expect(parseBackup(raw).data.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('저장된 하루 경계는 보존한다', () => {
    const raw = JSON.stringify({
      v: 1,
      data: { definitions: [], records: [], todos: [], settings: { dayBoundaryHour: 6 } },
    })
    expect(parseBackup(raw).data.settings.dayBoundaryHour).toBe(6)
  })
})

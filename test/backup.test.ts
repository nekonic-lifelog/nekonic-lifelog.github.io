import { beforeEach, describe, expect, it } from 'vitest'
import { BackupError, buildBackup, parseBackup, serializeBackup } from '../src/lib/backup'
import { fixedClock } from '../src/lib/clock'
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../src/lib/types'
import type { Snapshot } from '../src/data/store'
import {
  dailyRecords,
  makeBook,
  makeDef,
  makeJournal,
  makeProject,
  resetIds,
} from './factories'

const clock = fixedClock('2026-03-12T20:00:00+09:00')

function sampleSnapshot(): Snapshot {
  const def = makeDef({ name: '아침 약' })
  return {
    definitions: [def],
    records: dailyRecords(def.id, ['2026-03-10', '2026-03-11']),
    todos: [],
    projects: [makeProject()],
    books: [makeBook()],
    journal: [makeJournal()],
    settings: { ...DEFAULT_SETTINGS, dayBoundaryHour: 4 },
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

describe('불러오기 — 옛 백업 파일', () => {
  const old = () =>
    JSON.stringify({
      v: 1,
      exportedAt: '2026-03-12T11:00:00.000Z',
      data: { definitions: [], records: [], todos: [], settings: { dayBoundaryHour: 5 } },
    })

  it('projects · books · journal이 없으면 빈 배열로 채운다', () => {
    const parsed = parseBackup(old())
    expect(parsed.data.projects).toEqual([])
    expect(parsed.data.books).toEqual([])
    expect(parsed.data.journal).toEqual([])
  })

  it('없다고 해서 거부하지 않는다 — 나머지는 그대로 산다', () => {
    const parsed = parseBackup(old())
    expect(parsed.data.settings.dayBoundaryHour).toBe(5)
  })

  it('null로 적혀 있어도 빈 배열로 본다', () => {
    const raw = JSON.stringify({
      v: 1,
      data: { definitions: [], records: [], todos: [], projects: null, books: null, journal: null },
    })
    expect(parseBackup(raw).data.projects).toEqual([])
  })

  it('있는데 배열이 아니면 거부한다', () => {
    const raw = JSON.stringify({
      v: 1,
      data: { definitions: [], records: [], todos: [], journal: '기록' },
    })
    expect(() => parseBackup(raw)).toThrow(/journal 배열이 없습니다/)
  })

  it('새 테이블에서도 id 없는 행이면 위치를 알려준다', () => {
    const raw = JSON.stringify({
      v: 1,
      data: {
        definitions: [],
        records: [],
        todos: [],
        books: [{ id: 'b1' }, { title: 'id가 없다' }],
      },
    })
    expect(() => parseBackup(raw)).toThrow(/books\[1\]/)
  })
})

describe('불러오기 — 프로젝트 시작일', () => {
  const withProject = (project: Record<string, unknown>) =>
    JSON.stringify({
      v: 1,
      exportedAt: '2026-03-12T11:00:00.000Z',
      data: { definitions: [], records: [], todos: [], projects: [project] },
    })

  it('startAt이 없는 옛 프로젝트도 오류 없이 읽힌다', () => {
    const raw = withProject({
      id: 'p1',
      v: 1,
      createdAt: '2026-03-01T03:00:00.000Z',
      deviceId: 'old',
      updatedAt: '2026-03-01T03:00:00.000Z',
      deleted: false,
      name: '이사 준비',
      status: 'active',
      order: 0,
    })
    const parsed = parseBackup(raw)
    expect(parsed.data.projects).toHaveLength(1)
    expect(parsed.data.projects[0]?.startAt).toBeUndefined()
    expect(parsed.data.projects[0]?.name).toBe('이사 준비')
  })

  it('startAt이 있으면 그대로 실려 온다', () => {
    const snapshot = sampleSnapshot()
    snapshot.projects = [makeProject({ id: 'p1', startAt: '2026-03-05T03:00:00.000Z' })]
    const parsed = parseBackup(serializeBackup(snapshot, clock))
    expect(parsed.data.projects[0]?.startAt).toBe('2026-03-05T03:00:00.000Z')
  })
})

describe('내보내기 — 새 테이블', () => {
  it('세 테이블을 함께 실어 보내고 그대로 되읽는다', () => {
    const snapshot = sampleSnapshot()
    const file = buildBackup(snapshot, clock)
    expect(file.data.projects).toHaveLength(1)
    expect(file.data.books).toHaveLength(1)
    expect(file.data.journal).toHaveLength(1)

    const parsed = parseBackup(serializeBackup(snapshot, clock))
    expect(parsed.data.journal).toEqual(snapshot.journal)
    expect(parsed.data.books).toEqual(snapshot.books)
    expect(parsed.data.projects).toEqual(snapshot.projects)
  })
})

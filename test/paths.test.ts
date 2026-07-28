import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { TableName } from '../src/data/store'
import type { Base } from '../src/lib/types'
import {
  PathError,
  groupByPath,
  isOwnPath,
  monthOfPath,
  parsePath,
  pathFor,
} from '../src/sync/paths'

interface Row extends Base {
  at: string
  payload: number
}

let seq = 0

function makeRow(over: Partial<Row> = {}): Row {
  seq += 1
  const createdAt = over.createdAt ?? '2026-03-12T20:30:00.000Z'
  return {
    id: `row${seq}`,
    v: 1,
    createdAt,
    deviceId: 'phone',
    updatedAt: createdAt,
    deleted: false,
    at: createdAt,
    payload: 0,
    ...over,
  }
}

describe('경로 만들기', () => {
  it('기기별 테이블은 기기 파일 하나를 쓴다', () => {
    const row = makeRow({ deviceId: 'phone' })
    expect(pathFor('definitions', row)).toBe('/defs/phone.enc')
    expect(pathFor('todos', row)).toBe('/todos/phone.enc')
    expect(pathFor('projects', row)).toBe('/projects/phone.enc')
    expect(pathFor('books', row)).toBe('/books/phone.enc')
  })

  it('definitions는 defs 폴더에 들어간다', () => {
    expect(pathFor('definitions', makeRow())).not.toContain('/definitions/')
  })

  it('records는 월/일/기기로 나뉜다', () => {
    const row = makeRow({ createdAt: '2026-03-12T20:30:00.000Z', deviceId: 'pc' })
    expect(pathFor('records', row)).toBe('/records/2026-03/2026-03-12/pc.enc')
  })

  it('journal은 항목 하나가 파일 하나이고 기기로 나누지 않는다', () => {
    const row = makeRow({ id: 'entry-1', deviceId: 'pc' })
    expect(pathFor('journal', row)).toBe('/journal/2026-03/entry-1.enc')
    expect(pathFor('journal', row)).not.toContain('pc')
  })

  it('같은 journal 월의 두 항목은 서로 다른 파일이다', () => {
    const a = makeRow({ id: 'entry-a' })
    const b = makeRow({ id: 'entry-b' })
    expect(pathFor('journal', a)).not.toBe(pathFor('journal', b))
  })

  it('같은 기기·같은 날의 records는 한 파일에 모인다', () => {
    const a = makeRow({ createdAt: '2026-03-12T01:00:00.000Z', deviceId: 'pc' })
    const b = makeRow({ createdAt: '2026-03-12T23:00:00.000Z', deviceId: 'pc' })
    expect(pathFor('records', a)).toBe(pathFor('records', b))
  })

  it('기기가 다르면 records 파일이 갈린다', () => {
    const a = makeRow({ createdAt: '2026-03-12T01:00:00.000Z', deviceId: 'pc' })
    const b = makeRow({ createdAt: '2026-03-12T01:00:00.000Z', deviceId: 'phone' })
    expect(pathFor('records', a)).not.toBe(pathFor('records', b))
  })

  it('경로는 매번 같은 값을 낸다', () => {
    const row = makeRow({ createdAt: '2026-03-12T20:30:00.000Z' })
    const clone = JSON.parse(JSON.stringify(row)) as Row
    expect(pathFor('records', clone)).toBe(pathFor('records', row))
    expect(pathFor('records', row)).toBe(pathFor('records', row))
  })
})

describe('경로 불변성', () => {
  it('at을 다른 날로 바꿔도 records 경로는 그대로다', () => {
    const row = makeRow({ createdAt: '2026-03-12T20:30:00.000Z', at: '2026-03-12T20:30:00.000Z' })
    const before = pathFor('records', row)
    const moved: Row = { ...row, at: '2025-01-01T00:00:00.000Z' }
    expect(pathFor('records', moved)).toBe(before)
    expect(before).toBe('/records/2026-03/2026-03-12/phone.enc')
  })

  it('at을 다른 달로 바꿔도 journal 경로는 그대로다', () => {
    const row = makeRow({ id: 'entry-1', createdAt: '2026-03-12T20:30:00.000Z' })
    const moved: Row = { ...row, at: '2030-12-31T23:59:59.000Z' }
    expect(pathFor('journal', moved)).toBe('/journal/2026-03/entry-1.enc')
  })

  it('updatedAt이나 내용이 바뀌어도 경로는 그대로다', () => {
    const row = makeRow({ createdAt: '2026-03-12T20:30:00.000Z' })
    const before = pathFor('records', row)
    const edited: Row = { ...row, updatedAt: '2027-08-09T00:00:00.000Z', payload: 99, deleted: true }
    expect(pathFor('records', edited)).toBe(before)
  })

  it('createdAt이 다른 날이면 다른 파일이다', () => {
    const a = makeRow({ createdAt: '2026-03-12T23:59:59.000Z' })
    const b = makeRow({ createdAt: '2026-03-13T00:00:00.000Z' })
    expect(pathFor('records', a)).not.toBe(pathFor('records', b))
  })

  it('createdAt 문자열을 그대로 잘라 쓴다', () => {
    const row = makeRow({ createdAt: '2026-03-13T01:00:00+09:00' })
    expect(pathFor('records', row)).toBe('/records/2026-03/2026-03-13/phone.enc')
  })

  it('마지막 수정 기기가 바뀌면 records 파일이 옮겨간다', () => {
    const row = makeRow({ createdAt: '2026-03-12T20:30:00.000Z', deviceId: 'pc' })
    const taken: Row = { ...row, deviceId: 'phone' }
    expect(pathFor('records', taken)).toBe('/records/2026-03/2026-03-12/phone.enc')
  })
})

describe('경로 만들기 — 거부', () => {
  it('날짜로 읽을 수 없는 createdAt은 거부한다', () => {
    expect(() => pathFor('records', makeRow({ createdAt: '' }))).toThrow(PathError)
    expect(() => pathFor('records', makeRow({ createdAt: '어제' }))).toThrow(/날짜를 읽을 수 없습니다/)
    expect(() => pathFor('journal', makeRow({ createdAt: '2026-13-01T00:00:00.000Z' }))).toThrow(
      PathError,
    )
  })

  it('파일 이름으로 쓸 수 없는 deviceId는 거부한다', () => {
    expect(() => pathFor('todos', makeRow({ deviceId: 'a/b' }))).toThrow(PathError)
    expect(() => pathFor('todos', makeRow({ deviceId: '' }))).toThrow(/deviceId/)
    expect(() => pathFor('records', makeRow({ deviceId: '..' }))).toThrow(PathError)
  })

  it('파일 이름으로 쓸 수 없는 journal id는 거부한다', () => {
    expect(() => pathFor('journal', makeRow({ id: 'a/b' }))).toThrow(/id/)
  })
})

describe('경로 읽기', () => {
  it('기기별 파일에서 테이블과 기기를 되찾는다', () => {
    expect(parsePath('/defs/phone.enc')).toEqual({ table: 'definitions', deviceId: 'phone' })
    expect(parsePath('/todos/pc.enc')).toEqual({ table: 'todos', deviceId: 'pc' })
    expect(parsePath('/projects/pc.enc')).toEqual({ table: 'projects', deviceId: 'pc' })
    expect(parsePath('/books/pc.enc')).toEqual({ table: 'books', deviceId: 'pc' })
  })

  it('records 파일에서 월·일·기기를 되찾는다', () => {
    expect(parsePath('/records/2026-03/2026-03-12/pc.enc')).toEqual({
      table: 'records',
      deviceId: 'pc',
      month: '2026-03',
      day: '2026-03-12',
    })
  })

  it('journal 파일에서는 기기 대신 항목 id를 되찾는다', () => {
    const parsed = parsePath('/journal/2026-03/entry-1.enc')
    expect(parsed).toEqual({ table: 'journal', entryId: 'entry-1', month: '2026-03' })
    expect(parsed?.deviceId).toBeUndefined()
  })

  it('우리 규칙 밖의 경로는 null이다', () => {
    expect(parsePath('/meta/envelope.json')).toBeNull()
    expect(parsePath('/meta/envelope.enc')).toBeNull()
    expect(parsePath('/definitions/pc.enc')).toBeNull()
    expect(parsePath('/defs/pc.json')).toBeNull()
    expect(parsePath('defs/pc.enc')).toBeNull()
    expect(parsePath('/defs/pc')).toBeNull()
    expect(parsePath('/defs/.enc')).toBeNull()
    expect(parsePath('/defs/a/b.enc')).toBeNull()
    expect(parsePath('/')).toBeNull()
    expect(parsePath('')).toBeNull()
  })

  it('날짜 폴더가 어긋난 records 경로는 null이다', () => {
    expect(parsePath('/records/2026-03/pc.enc')).toBeNull()
    expect(parsePath('/records/2026-3/2026-03-12/pc.enc')).toBeNull()
    expect(parsePath('/records/2026-13/2026-13-12/pc.enc')).toBeNull()
    expect(parsePath('/records/2026-03/2026-04-12/pc.enc')).toBeNull()
    expect(parsePath('/records/2026-03/2026-03-32/pc.enc')).toBeNull()
    expect(parsePath('/records/2026-03/2026-03-12/a/pc.enc')).toBeNull()
  })

  it('달 폴더가 어긋난 journal 경로는 null이다', () => {
    expect(parsePath('/journal/2026-3/entry-1.enc')).toBeNull()
    expect(parsePath('/journal/entry-1.enc')).toBeNull()
    expect(parsePath('/journal/2026-03/2026-03-12/entry-1.enc')).toBeNull()
  })
})

describe('내 파일 판별', () => {
  it('기기 이름이 같은 파일만 내 것이다', () => {
    expect(isOwnPath('/defs/phone.enc', 'phone')).toBe(true)
    expect(isOwnPath('/defs/phone.enc', 'pc')).toBe(false)
    expect(isOwnPath('/records/2026-03/2026-03-12/pc.enc', 'pc')).toBe(true)
    expect(isOwnPath('/records/2026-03/2026-03-12/pc.enc', 'phone')).toBe(false)
  })

  it('journal 파일은 어느 기기의 것도 아니다', () => {
    expect(isOwnPath('/journal/2026-03/entry-1.enc', 'phone')).toBe(false)
    expect(isOwnPath('/journal/2026-03/phone.enc', 'phone')).toBe(false)
  })

  it('규칙 밖의 경로는 내 것이 아니다', () => {
    expect(isOwnPath('/meta/envelope.json', 'phone')).toBe(false)
  })
})

describe('경로의 달', () => {
  it('날짜가 있는 경로에서만 달을 낸다', () => {
    expect(monthOfPath('/records/2026-03/2026-03-12/pc.enc')).toBe('2026-03')
    expect(monthOfPath('/journal/2026-03/entry-1.enc')).toBe('2026-03')
    expect(monthOfPath('/defs/pc.enc')).toBeNull()
    expect(monthOfPath('/todos/pc.enc')).toBeNull()
    expect(monthOfPath('/meta/envelope.json')).toBeNull()
  })
})

describe('경로별 묶기', () => {
  it('테이블과 기기와 날짜로 파일을 가른다', () => {
    const a = makeRow({ createdAt: '2026-03-12T01:00:00.000Z', deviceId: 'pc' })
    const b = makeRow({ createdAt: '2026-03-12T09:00:00.000Z', deviceId: 'pc' })
    const c = makeRow({ createdAt: '2026-03-13T01:00:00.000Z', deviceId: 'pc' })
    const d = makeRow({ createdAt: '2026-03-12T01:00:00.000Z', deviceId: 'phone' })
    const todo = makeRow({ deviceId: 'pc' })
    const grouped = groupByPath({ records: [a, b, c, d], todos: [todo] })

    expect([...grouped.keys()].sort()).toEqual([
      '/records/2026-03/2026-03-12/pc.enc',
      '/records/2026-03/2026-03-12/phone.enc',
      '/records/2026-03/2026-03-13/pc.enc',
      '/todos/pc.enc',
    ])
    expect(grouped.get('/records/2026-03/2026-03-12/pc.enc')).toEqual({
      table: 'records',
      rows: [a, b],
    })
    expect(grouped.get('/todos/pc.enc')?.table).toBe('todos')
  })

  it('journal은 항목마다 파일을 만든다', () => {
    const a = makeRow({ id: 'entry-a' })
    const b = makeRow({ id: 'entry-b' })
    const grouped = groupByPath({ journal: [a, b] })
    expect(grouped.size).toBe(2)
    expect(grouped.get('/journal/2026-03/entry-a.enc')?.rows).toEqual([a])
  })

  it('빈 테이블과 없는 테이블은 파일을 만들지 않는다', () => {
    expect(groupByPath({}).size).toBe(0)
    expect(groupByPath({ todos: [] }).size).toBe(0)
  })

  it('지운 행도 원래 파일에 그대로 담긴다', () => {
    const row = makeRow({ deviceId: 'pc', deleted: true })
    const grouped = groupByPath({ todos: [row] })
    expect(grouped.get('/todos/pc.enc')?.rows).toEqual([row])
  })
})

describe('속성 — 경로', () => {
  const arbName = fc.constantFrom('phone', 'pc', 'a-1', 'B_2')
  const arbCreatedAt = fc
    .tuple(
      fc.integer({ min: 2020, max: 2030 }),
      fc.integer({ min: 1, max: 12 }),
      fc.integer({ min: 1, max: 28 }),
      fc.integer({ min: 0, max: 23 }),
    )
    .map(([y, m, d, h]) => {
      const p = (n: number) => String(n).padStart(2, '0')
      return `${y}-${p(m)}-${p(d)}T${p(h)}:00:00.000Z`
    })
  const arbTable = fc.constantFrom<TableName>(
    'definitions',
    'records',
    'todos',
    'projects',
    'books',
    'journal',
  )
  const arbRow = fc
    .record({
      id: arbName,
      deviceId: arbName,
      createdAt: arbCreatedAt,
      updatedAt: arbCreatedAt,
      at: arbCreatedAt,
      deleted: fc.boolean(),
      payload: fc.integer({ min: 0, max: 9 }),
    })
    .map((r): Row => ({ ...r, v: 1 }))

  it('만든 경로는 다시 읽을 수 있다', () => {
    fc.assert(
      fc.property(arbTable, arbRow, (table, row) => {
        const parsed = parsePath(pathFor(table, row))
        expect(parsed).not.toBeNull()
        expect(parsed?.table).toBe(table)
        if (table === 'journal') expect(parsed?.entryId).toBe(row.id)
        else expect(parsed?.deviceId).toBe(row.deviceId)
      }),
      { numRuns: 300 },
    )
  })

  it('createdAt과 기기가 같으면 나머지가 어떻게 바뀌어도 경로가 같다', () => {
    fc.assert(
      fc.property(arbTable, arbRow, arbCreatedAt, fc.integer(), fc.boolean(), (table, row, other, n, del) => {
        const edited: Row = { ...row, at: other, updatedAt: other, payload: n, deleted: del }
        expect(pathFor(table, edited)).toBe(pathFor(table, row))
      }),
      { numRuns: 300 },
    )
  })

  it('경로가 같은 행끼리는 같은 테이블·기기·날짜다', () => {
    fc.assert(
      fc.property(arbTable, arbRow, arbRow, (table, a, b) => {
        if (pathFor(table, a) !== pathFor(table, b)) return
        if (table === 'journal') expect(a.id).toBe(b.id)
        else expect(a.deviceId).toBe(b.deviceId)
        if (table === 'records' || table === 'journal') {
          expect(a.createdAt.slice(0, 7)).toBe(b.createdAt.slice(0, 7))
        }
      }),
      { numRuns: 300 },
    )
  })

  it('내 파일 판별은 경로의 기기 이름과 일치한다', () => {
    fc.assert(
      fc.property(arbTable, arbRow, arbName, (table, row, device) => {
        const path = pathFor(table, row)
        const expected = table !== 'journal' && row.deviceId === device
        expect(isOwnPath(path, device)).toBe(expected)
      }),
      { numRuns: 300 },
    )
  })
})

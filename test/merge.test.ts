import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Snapshot, TableName } from '../src/data/store'
import { DEFAULT_SETTINGS, type Base, type Settings } from '../src/lib/types'
import {
  liveRows,
  mergeRows,
  mergeSnapshots,
  ownRows,
  type Clash,
  type RowClash,
} from '../src/sync/merge'

interface Row extends Base {
  payload: number
}

const T0 = Date.UTC(2026, 2, 12, 0, 0, 0)

function at(minute: number): string {
  return new Date(T0 + minute * 60_000).toISOString()
}

function makeRow(over: Partial<Row> & { id: string }): Row {
  return {
    v: 1,
    createdAt: at(0),
    deviceId: 'phone',
    updatedAt: at(0),
    deleted: false,
    payload: 0,
    ...over,
  }
}

function ids(rows: Row[]): string[] {
  return rows.map((r) => r.id).sort()
}

function snap(
  over: Partial<Record<TableName, Base[]>> = {},
  settings: Settings = DEFAULT_SETTINGS,
): Snapshot {
  const empty = {
    definitions: [],
    records: [],
    todos: [],
    projects: [],
    books: [],
    journal: [],
  }
  return { ...empty, ...over, settings } as unknown as Snapshot
}

describe('병합 — 승자 고르기', () => {
  it('updatedAt이 최신인 쪽이 이긴다', () => {
    const old = makeRow({ id: 'x', deviceId: 'pc', updatedAt: at(1), payload: 1 })
    const fresh = makeRow({ id: 'x', deviceId: 'phone', updatedAt: at(2), payload: 2 })
    expect(mergeRows([[old], [fresh]])).toEqual([fresh])
    expect(mergeRows([[fresh], [old]])).toEqual([fresh])
  })

  it('updatedAt이 같으면 기기 이름과 상관없이 지운 쪽이 이긴다', () => {
    const live = makeRow({ id: 'x', deviceId: 'pc', updatedAt: at(1) })
    const gone = makeRow({ id: 'x', deviceId: 'phone', updatedAt: at(1), deleted: true })
    expect(mergeRows([[live], [gone]])).toEqual([gone])
    expect(mergeRows([[gone], [live]])).toEqual([gone])

    const live2 = makeRow({ id: 'y', deviceId: 'phone', updatedAt: at(1) })
    const gone2 = makeRow({ id: 'y', deviceId: 'pc', updatedAt: at(1), deleted: true })
    expect(mergeRows([[live2], [gone2]])).toEqual([gone2])
    expect(mergeRows([[gone2], [live2]])).toEqual([gone2])
  })

  it('updatedAt과 삭제 여부가 같으면 기기 이름 사전순으로 앞선 쪽이 이긴다', () => {
    const phone = makeRow({ id: 'x', deviceId: 'phone', updatedAt: at(1), payload: 1 })
    const pc = makeRow({ id: 'x', deviceId: 'pc', updatedAt: at(1), payload: 2 })
    expect(mergeRows([[phone], [pc]])).toEqual([pc])
    expect(mergeRows([[pc], [phone]])).toEqual([pc])
  })

  it('같은 시각을 다르게 적은 문자열도 한쪽으로 결정된다', () => {
    const z = makeRow({ id: 'x', deviceId: 'pc', updatedAt: '2026-03-12T09:00:00.000Z' })
    const offset = makeRow({ id: 'x', deviceId: 'pc', updatedAt: '2026-03-12T18:00:00+09:00' })
    expect(mergeRows([[z], [offset]])).toEqual(mergeRows([[offset], [z]]))
    expect(mergeRows([[z], [offset]])).toEqual([offset])
  })

  it('모든 비교 항목이 같고 내용만 다르면 그래도 한쪽으로 결정된다', () => {
    const a = makeRow({ id: 'x', deviceId: 'pc', updatedAt: at(1), payload: 1 })
    const b = makeRow({ id: 'x', deviceId: 'pc', updatedAt: at(1), payload: 2 })
    expect(mergeRows([[a], [b]])).toEqual(mergeRows([[b], [a]]))
  })

  it('빈 입력은 빈 결과다', () => {
    expect(mergeRows([])).toEqual([])
    expect(mergeRows([[], []])).toEqual([])
  })

  it('결과는 id 순으로 정렬된다', () => {
    const rows = [makeRow({ id: 'c' }), makeRow({ id: 'a' }), makeRow({ id: 'b' })]
    expect(mergeRows([rows]).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('병합 — 무덤', () => {
  it('지운 행은 병합 결과에 남는다', () => {
    const gone = makeRow({ id: 'x', updatedAt: at(2), deleted: true })
    const older = makeRow({ id: 'x', deviceId: 'pc', updatedAt: at(1) })
    const merged = mergeRows([[older], [gone]])
    expect(merged).toEqual([gone])
    expect(merged[0]?.deleted).toBe(true)
  })

  it('낡은 사본이 지운 행을 되살리지 못한다', () => {
    const gone = makeRow({ id: 'x', deviceId: 'phone', updatedAt: at(5), deleted: true })
    const stale = makeRow({ id: 'x', deviceId: 'pc', updatedAt: at(4) })
    expect(mergeRows([[stale], [gone], [stale]])[0]?.deleted).toBe(true)
  })

  it('더 나중에 되살리면 살아난다', () => {
    const gone = makeRow({ id: 'x', deviceId: 'phone', updatedAt: at(5), deleted: true })
    const back = makeRow({ id: 'x', deviceId: 'pc', updatedAt: at(6) })
    expect(mergeRows([[gone], [back]])).toEqual([back])
  })

  it('노출 단계에서만 지운 행을 걸러낸다', () => {
    const live = makeRow({ id: 'a' })
    const gone = makeRow({ id: 'b', deleted: true })
    expect(liveRows(mergeRows([[live, gone]]))).toEqual([live])
  })
})

describe('내 파일에 담을 행', () => {
  it('내가 마지막으로 고친 행만 담는다', () => {
    const mine = makeRow({ id: 'a', deviceId: 'phone' })
    const theirs = makeRow({ id: 'b', deviceId: 'pc' })
    expect(ownRows([mine, theirs], 'phone')).toEqual([mine])
    expect(ownRows([mine, theirs], 'pc')).toEqual([theirs])
  })

  it('지운 행도 내 파일에 담는다', () => {
    const gone = makeRow({ id: 'a', deviceId: 'phone', deleted: true })
    expect(ownRows([gone], 'phone')).toEqual([gone])
  })

  it('남이 만든 행을 내가 고치면 내 파일로 넘어오고 상대 파일에는 낡은 사본이 남는다', () => {
    const pcFile = [makeRow({ id: 'x', deviceId: 'pc', updatedAt: at(1), payload: 1 })]
    const mineNow = makeRow({ id: 'x', deviceId: 'phone', updatedAt: at(2), payload: 2 })
    const phoneFile = [mineNow]

    const merged = mergeRows([pcFile, phoneFile])
    expect(merged).toEqual([mineNow])
    expect(ownRows(merged, 'phone')).toEqual([mineNow])
    expect(ownRows(merged, 'pc')).toEqual([])

    const stillStale = mergeRows([pcFile, ownRows(merged, 'phone')])
    expect(stillStale).toEqual([mineNow])
  })
})

describe('스냅샷 병합', () => {
  it('여섯 테이블을 모두 병합한다', () => {
    const local = snap({
      definitions: [makeRow({ id: 'd1', updatedAt: at(1) })],
      records: [makeRow({ id: 'r1', updatedAt: at(1) })],
      todos: [makeRow({ id: 't1', updatedAt: at(1) })],
      projects: [makeRow({ id: 'p1', updatedAt: at(1) })],
      books: [makeRow({ id: 'b1', updatedAt: at(1) })],
      journal: [makeRow({ id: 'j1', updatedAt: at(1) })],
    })
    const remote = snap({
      definitions: [makeRow({ id: 'd2', deviceId: 'pc' })],
      records: [makeRow({ id: 'r1', deviceId: 'pc', updatedAt: at(9), payload: 7 })],
      todos: [makeRow({ id: 't2', deviceId: 'pc' })],
      projects: [makeRow({ id: 'p2', deviceId: 'pc' })],
      books: [makeRow({ id: 'b2', deviceId: 'pc' })],
      journal: [makeRow({ id: 'j2', deviceId: 'pc' })],
    })
    const merged = mergeSnapshots(local, remote)
    expect(merged.definitions.map((r) => r.id)).toEqual(['d1', 'd2'])
    expect(merged.todos.map((r) => r.id)).toEqual(['t1', 't2'])
    expect(merged.projects.map((r) => r.id)).toEqual(['p1', 'p2'])
    expect(merged.books.map((r) => r.id)).toEqual(['b1', 'b2'])
    expect(merged.journal.map((r) => r.id)).toEqual(['j1', 'j2'])
    expect(merged.records).toHaveLength(1)
    expect(merged.records[0]?.deviceId).toBe('pc')
  })

  it('원격에 없는 테이블은 로컬을 그대로 남긴다', () => {
    const local = snap({ todos: [makeRow({ id: 't1' })] })
    const merged = mergeSnapshots(local, { books: [] } as Partial<Snapshot>)
    expect(merged.todos).toHaveLength(1)
    expect(merged.books).toEqual([])
  })

  it('설정은 이 기기 것을 유지한다', () => {
    const local = snap({}, { ...DEFAULT_SETTINGS, dayBoundaryHour: 4 })
    const remote = snap({}, { ...DEFAULT_SETTINGS, dayBoundaryHour: 9 })
    expect(mergeSnapshots(local, remote).settings).toEqual({
      ...DEFAULT_SETTINGS,
      dayBoundaryHour: 4,
    })
  })
})

describe('덮어쓴 판정 자국', () => {
  function caught(groups: Row[][]): RowClash[] {
    const found: RowClash[] = []
    mergeRows(groups, (clash) => found.push(clash))
    return found
  }

  it('두 기기가 같은 행을 고치면 진 쪽이 남는다', () => {
    const mine = makeRow({ id: 'x', deviceId: 'phone', updatedAt: at(1), payload: 1 })
    const yours = makeRow({ id: 'x', deviceId: 'pc', updatedAt: at(2), payload: 2 })
    expect(caught([[mine], [yours]])).toEqual([
      { id: 'x', winnerDeviceId: 'pc', loserDeviceId: 'phone', loserUpdatedAt: at(1) },
    ])
    expect(caught([[yours], [mine]])).toEqual([
      { id: 'x', winnerDeviceId: 'pc', loserDeviceId: 'phone', loserUpdatedAt: at(1) },
    ])
  })

  it('자국에 본문이 들어 있지 않다', () => {
    const mine = makeRow({ id: 'x', deviceId: 'phone', updatedAt: at(1), payload: 11 })
    const yours = makeRow({ id: 'x', deviceId: 'pc', updatedAt: at(2), payload: 22 })
    const found = caught([[mine], [yours]])
    expect(JSON.stringify(found)).not.toContain('payload')
    expect(JSON.stringify(found)).not.toContain('11')
    expect(Object.keys(found[0] ?? {}).sort()).toEqual([
      'id',
      'loserDeviceId',
      'loserUpdatedAt',
      'winnerDeviceId',
    ])
  })

  it('한 기기가 제 행을 고친 것은 겹침이 아니다', () => {
    const older = makeRow({ id: 'x', deviceId: 'phone', updatedAt: at(1), payload: 1 })
    const newer = makeRow({ id: 'x', deviceId: 'phone', updatedAt: at(3), payload: 2 })
    expect(caught([[older], [newer]])).toEqual([])
    expect(caught([[newer], [newer]])).toEqual([])
    expect(caught([[older], [makeRow({ id: 'y', deviceId: 'pc' })]])).toEqual([])
  })

  it('같은 id가 여러 번 겹쳐도 자국은 한 줄이다', () => {
    const old = makeRow({ id: 'x', deviceId: 'phone', updatedAt: at(1) })
    const mid = makeRow({ id: 'x', deviceId: 'phone', updatedAt: at(3) })
    const win = makeRow({ id: 'x', deviceId: 'pc', updatedAt: at(5) })
    expect(caught([[old], [mid], [win], [mid], [old]])).toEqual([
      { id: 'x', winnerDeviceId: 'pc', loserDeviceId: 'phone', loserUpdatedAt: at(3) },
    ])
  })

  it('테이블 이름은 스냅샷 병합이 붙인다', () => {
    const local = snap({
      books: [makeRow({ id: 'b1', deviceId: 'phone', updatedAt: at(1) })],
      todos: [makeRow({ id: 't1', deviceId: 'phone', updatedAt: at(1) })],
    })
    const remote = snap({
      books: [makeRow({ id: 'b1', deviceId: 'pc', updatedAt: at(4) })],
    })
    const found: Clash[] = []
    mergeSnapshots(local, remote, (clash) => found.push(clash))
    expect(found).toEqual([
      { table: 'books', id: 'b1', winnerDeviceId: 'pc', loserDeviceId: 'phone', loserUpdatedAt: at(1) },
    ])
  })

  it('자국을 받지 않아도 병합 결과는 같다', () => {
    const groups = [
      [makeRow({ id: 'x', deviceId: 'phone', updatedAt: at(1) })],
      [makeRow({ id: 'x', deviceId: 'pc', updatedAt: at(2) })],
      [makeRow({ id: 'y', deviceId: 'pc', updatedAt: at(2) })],
    ]
    expect(mergeRows(groups, () => undefined)).toEqual(mergeRows(groups))
  })
})

const arbId = fc.constantFrom('a', 'b', 'c', 'd')
const arbDevice = fc.constantFrom('phone', 'pc')
const arbMinute = fc.integer({ min: 0, max: 8 })

const arbRow: fc.Arbitrary<Row> = fc
  .record({
    id: arbId,
    deviceId: arbDevice,
    minute: arbMinute,
    deleted: fc.boolean(),
    payload: fc.integer({ min: 0, max: 3 }),
  })
  .map(({ id, deviceId, minute, deleted, payload }) =>
    makeRow({ id, deviceId, updatedAt: at(minute), deleted, payload }),
  )

const arbRows = fc.array(arbRow, { maxLength: 12 })

const arbRowsWithShuffle = arbRows.chain((rows) =>
  fc.tuple(
    fc.constant(rows),
    fc.shuffledSubarray(rows, { minLength: rows.length, maxLength: rows.length }),
  ),
)

const arbGroups = fc.array(fc.array(arbRow, { maxLength: 5 }), { maxLength: 4 })

function partition(rows: Row[], k: number): Row[][] {
  const out: Row[][] = Array.from({ length: k }, () => [])
  rows.forEach((row, i) => out[i % k]?.push(row))
  return out
}

const DEVICES = ['phone', 'pc'] as const

interface Op {
  kind: 'edit' | 'push' | 'pull'
  device: string
  id: string
  minute: number
  deleted: boolean
  payload: number
}

const arbOp: fc.Arbitrary<Op> = fc.record({
  kind: fc.constantFrom<Op['kind']>('edit', 'edit', 'push', 'pull'),
  device: arbDevice,
  id: arbId,
  minute: arbMinute,
  deleted: fc.boolean(),
  payload: fc.integer({ min: 0, max: 3 }),
})

interface World {
  store: Map<string, Row[]>
  remote: Map<string, Row[]>
}

function emptyWorld(): World {
  return {
    store: new Map(DEVICES.map((d) => [d, [] as Row[]])),
    remote: new Map(),
  }
}

function push(world: World, device: string): void {
  world.remote.set(device, ownRows(world.store.get(device) ?? [], device))
}

function pull(world: World, device: string): void {
  world.store.set(
    device,
    mergeRows([world.store.get(device) ?? [], ...world.remote.values()]),
  )
}

function minuteOf(row: Row): number {
  return (Date.parse(row.updatedAt) - T0) / 60_000
}

function edit(world: World, op: Op): void {
  const own = world.store.get(op.device) ?? []
  const prev = own.find((row) => row.id === op.id)
  const minute = prev === undefined ? op.minute : Math.max(op.minute, minuteOf(prev) + 1)
  const next = own.filter((row) => row.id !== op.id)
  next.push(
    makeRow({
      id: op.id,
      deviceId: op.device,
      updatedAt: at(minute),
      deleted: op.deleted,
      payload: op.payload,
    }),
  )
  world.store.set(op.device, next)
}

function run(ops: Op[]): World {
  const world = emptyWorld()
  for (const op of ops) {
    if (op.kind === 'edit') edit(world, op)
    else if (op.kind === 'push') push(world, op.device)
    else pull(world, op.device)
  }
  return world
}

function settle(world: World): void {
  for (const d of DEVICES) push(world, d)
  for (const d of DEVICES) pull(world, d)
}

describe('속성 — 수렴', () => {
  it('임의 순서로 고치고 주고받아도 두 기기가 같은 상태에 이른다', () => {
    fc.assert(
      fc.property(fc.array(arbOp, { maxLength: 40 }), (ops) => {
        const world = run(ops)
        settle(world)
        expect(world.store.get('pc')).toEqual(world.store.get('phone'))
      }),
      { numRuns: 400 },
    )
  })

  it('한 번 맞춘 뒤 더 주고받아도 상태가 그대로다', () => {
    fc.assert(
      fc.property(fc.array(arbOp, { maxLength: 40 }), (ops) => {
        const world = run(ops)
        settle(world)
        const before = world.store.get('phone')
        settle(world)
        settle(world)
        expect(world.store.get('phone')).toEqual(before)
        expect(world.store.get('pc')).toEqual(before)
      }),
      { numRuns: 300 },
    )
  })

  it('읽는 기기에 따라 결과가 달라지지 않는다', () => {
    fc.assert(
      fc.property(fc.array(arbOp, { maxLength: 40 }), (ops) => {
        const world = run(ops)
        for (const d of DEVICES) push(world, d)
        const files = [...world.remote.values()]
        const asPhone = mergeRows([...files])
        const asPc = mergeRows([...files].reverse())
        expect(asPc).toEqual(asPhone)
      }),
      { numRuns: 300 },
    )
  })
})

describe('속성 — 병합의 대수적 성질', () => {
  it('교환법칙·결합법칙: 넣는 순서와 묶는 방식이 결과를 바꾸지 않는다', () => {
    fc.assert(
      fc.property(
        arbRowsWithShuffle,
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 4 }),
        ([rows, shuffled], k1, k2) => {
          const base = mergeRows(partition(rows, k1))
          expect(mergeRows(partition(shuffled, k2))).toEqual(base)
          expect(mergeRows([rows])).toEqual(base)
          expect(mergeRows([shuffled])).toEqual(base)
          expect(mergeRows(rows.map((row) => [row]))).toEqual(base)
          expect(mergeRows(shuffled.map((row) => [row]))).toEqual(base)
        },
      ),
      { numRuns: 400 },
    )
  })

  it('멱등성: 이미 병합한 결과를 다시 병합해도 그대로다', () => {
    fc.assert(
      fc.property(arbGroups, (groups) => {
        const merged = mergeRows(groups)
        expect(mergeRows([merged])).toEqual(merged)
        expect(mergeRows([merged, merged])).toEqual(merged)
        expect(mergeRows([merged, ...groups])).toEqual(merged)
        expect(mergeRows([...groups, merged])).toEqual(merged)
      }),
      { numRuns: 400 },
    )
  })

  it('id는 사라지지 않고 한 번만 남는다', () => {
    fc.assert(
      fc.property(arbGroups, (groups) => {
        const merged = mergeRows(groups)
        const inputIds = [...new Set(groups.flat().map((row) => row.id))].sort()
        expect(ids(merged)).toEqual(inputIds)
        expect(merged).toHaveLength(inputIds.length)
      }),
      { numRuns: 400 },
    )
  })

  it('자국을 모아도 병합 결과가 달라지지 않는다', () => {
    fc.assert(
      fc.property(arbGroups, (groups) => {
        const found: RowClash[] = []
        expect(mergeRows(groups, (clash) => found.push(clash))).toEqual(mergeRows(groups))
        const merged = mergeRows(groups)
        for (const clash of found) {
          const winner = merged.find((row) => row.id === clash.id)
          expect(winner?.deviceId).toBe(clash.winnerDeviceId)
          expect(clash.loserDeviceId).not.toBe(clash.winnerDeviceId)
        }
        expect(new Set(found.map((c) => c.id)).size).toBe(found.length)
      }),
      { numRuns: 400 },
    )
  })

  it('승자는 입력에 실제로 있던 행이다', () => {
    fc.assert(
      fc.property(arbGroups, (groups) => {
        const flat = groups.flat()
        for (const row of mergeRows(groups)) {
          expect(flat).toContainEqual(row)
        }
      }),
      { numRuns: 300 },
    )
  })
})

describe('속성 — 무덤', () => {
  it('가장 나중에 지운 행은 어떤 순서로 섞어도 되살아나지 않는다', () => {
    const arbCase = arbGroups
      .filter((groups) => groups.flat().length > 0)
      .chain((groups) =>
        fc.tuple(fc.constant(groups), fc.constantFrom(...groups.flat().map((row) => row.id))),
      )
    fc.assert(
      fc.property(arbCase, arbDevice, ([groups, id], device) => {
        const tomb = makeRow({ id, deviceId: device, updatedAt: at(99), deleted: true })
        const withTomb = [...groups, [tomb]]
        const shuffled = [[tomb], ...groups].reverse()
        const merged = mergeRows(withTomb)
        const found = merged.find((row) => row.id === id)
        expect(found?.deleted).toBe(true)
        expect(mergeRows(shuffled).find((row) => row.id === id)?.deleted).toBe(true)
        expect(liveRows(merged).some((row) => row.id === id)).toBe(false)
      }),
      { numRuns: 400 },
    )
  })

  it('같은 시각의 되살림은 지운 행을 이기지 못한다', () => {
    fc.assert(
      fc.property(arbGroups, arbId, arbDevice, arbDevice, (groups, id, a, b) => {
        const tomb = makeRow({ id, deviceId: a, updatedAt: at(99), deleted: true })
        const revive = makeRow({ id, deviceId: b, updatedAt: at(99), payload: 3 })
        expect(mergeRows([...groups, [tomb], [revive]]).find((row) => row.id === id)?.deleted).toBe(
          true,
        )
        expect(mergeRows([[revive], ...groups, [tomb]]).find((row) => row.id === id)?.deleted).toBe(
          true,
        )
      }),
      { numRuns: 300 },
    )
  })

  it('주고받기를 반복해도 지운 항목이 되살아나지 않는다', () => {
    fc.assert(
      fc.property(fc.array(arbOp, { maxLength: 30 }), arbId, arbDevice, (ops, id, device) => {
        const world = run(ops)
        settle(world)
        edit(world, { kind: 'edit', device, id, minute: 99, deleted: true, payload: 0 })
        settle(world)
        settle(world)
        for (const d of DEVICES) {
          const rows = world.store.get(d) ?? []
          expect(rows.find((row) => row.id === id)?.deleted).toBe(true)
          expect(liveRows(rows).some((row) => row.id === id)).toBe(false)
        }
      }),
      { numRuns: 300 },
    )
  })
})

describe('속성 — 기기 파일 분할', () => {
  it('기기별로 쪼개 다시 합치면 원본과 같다', () => {
    fc.assert(
      fc.property(arbGroups, (groups) => {
        const merged = mergeRows(groups)
        const devices = [...new Set(merged.map((row) => row.deviceId))].sort()
        const files = devices.map((device) => ownRows(merged, device))
        expect(mergeRows(files)).toEqual(merged)
        expect(files.reduce((n, file) => n + file.length, 0)).toBe(merged.length)
      }),
      { numRuns: 400 },
    )
  })

  it('같은 행이 두 기기 파일에 동시에 들어가지 않는다', () => {
    fc.assert(
      fc.property(arbGroups, (groups) => {
        const merged = mergeRows(groups)
        const phone = new Set(ownRows(merged, 'phone').map((row) => row.id))
        const pc = new Set(ownRows(merged, 'pc').map((row) => row.id))
        for (const id of phone) expect(pc.has(id)).toBe(false)
        expect(phone.size + pc.size).toBe(merged.length)
      }),
      { numRuns: 400 },
    )
  })

  it('주고받은 뒤에도 원격 파일들이 서로 겹치지 않는다', () => {
    fc.assert(
      fc.property(fc.array(arbOp, { maxLength: 40 }), (ops) => {
        const world = run(ops)
        settle(world)
        settle(world)
        const seen = new Set<string>()
        for (const file of world.remote.values()) {
          for (const row of file) {
            expect(seen.has(row.id)).toBe(false)
            seen.add(row.id)
          }
        }
        expect(ids([...world.remote.values()].flat())).toEqual(ids(world.store.get('phone') ?? []))
      }),
      { numRuns: 300 },
    )
  })
})

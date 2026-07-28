import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { IdbStore } from '../src/data/idb'
import type { Snapshot } from '../src/data/store'
import { DEFAULT_SETTINGS } from '../src/lib/types'
import { dailyRecords, makeDef, resetIds } from './factories'

const opened: IdbStore[] = []

function track(store: IdbStore): IdbStore {
  opened.push(store)
  return store
}

async function freshStore(): Promise<IdbStore> {
  for (const store of opened) store.close()
  opened.length = 0
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('lifelog')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('deleteDatabase가 blocked 되었습니다'))
  })
  return track(new IdbStore())
}

beforeEach(resetIds)

describe('deviceId', () => {
  it('한 번 발급하면 계속 같은 값을 돌려준다', async () => {
    const store = await freshStore()
    const first = await store.deviceId()
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(await store.deviceId()).toBe(first)
  })

  it('같은 DB를 새 인스턴스로 열어도 유지된다 — 새 파일이 생기면 안 된다', async () => {
    const store = await freshStore()
    const first = await store.deviceId()
    expect(await track(new IdbStore()).deviceId()).toBe(first)
  })
})

describe('읽고 쓰기', () => {
  it('빈 저장소는 기본 설정을 돌려준다', async () => {
    const store = await freshStore()
    const snapshot = await store.loadAll()
    expect(snapshot).toEqual({
      definitions: [],
      records: [],
      todos: [],
      settings: DEFAULT_SETTINGS,
    })
  })

  it('쓴 것을 그대로 읽는다', async () => {
    const store = await freshStore()
    const def = makeDef()
    const records = dailyRecords(def.id, ['2026-03-10', '2026-03-11'])
    await store.put('definitions', [def])
    await store.put('records', records)

    const snapshot = await store.loadAll()
    expect(snapshot.definitions).toEqual([def])
    expect(snapshot.records).toHaveLength(2)
  })

  it('같은 id로 다시 쓰면 갱신된다', async () => {
    const store = await freshStore()
    const def = makeDef({ name: '아침 약' })
    await store.put('definitions', [def])
    await store.put('definitions', [{ ...def, name: '저녁 약' }])

    const snapshot = await store.loadAll()
    expect(snapshot.definitions).toHaveLength(1)
    expect(snapshot.definitions[0]!.name).toBe('저녁 약')
  })

  it('tombstone은 삭제가 아니라 평범한 쓰기다', async () => {
    const store = await freshStore()
    const def = makeDef()
    await store.put('definitions', [def])
    await store.put('definitions', [{ ...def, deleted: true }])

    const snapshot = await store.loadAll()
    expect(snapshot.definitions).toHaveLength(1)
    expect(snapshot.definitions[0]!.deleted).toBe(true)
  })
})

describe('replaceAll — 불러오기', () => {
  const incoming = (): Snapshot => {
    const def = makeDef({ name: '물' })
    return {
      definitions: [def],
      records: dailyRecords(def.id, ['2026-03-11']),
      todos: [],
      settings: { dayBoundaryHour: 6 },
    }
  }

  it('기존 데이터를 남기지 않고 통째로 갈아끼운다', async () => {
    const store = await freshStore()
    const old = makeDef({ name: '지워질 것' })
    await store.put('definitions', [old])
    await store.put('records', dailyRecords(old.id, ['2026-03-01', '2026-03-02']))

    const next = incoming()
    await store.replaceAll(next)

    const snapshot = await store.loadAll()
    expect(snapshot.definitions).toHaveLength(1)
    expect(snapshot.definitions[0]!.name).toBe('물')
    expect(snapshot.records).toHaveLength(1)
    expect(snapshot.settings.dayBoundaryHour).toBe(6)
  })

  it('deviceId는 이 기기의 것을 유지한다', async () => {
    const store = await freshStore()
    const before = await store.deviceId()
    await store.replaceAll(incoming())
    expect(await store.deviceId()).toBe(before)
  })

  it('중간에 실패하면 아무것도 반영하지 않는다 — 부분 적용이 없다', async () => {
    const store = await freshStore()
    const original = makeDef({ name: '지켜져야 할 것' })
    await store.put('definitions', [original])
    await store.put('records', dailyRecords(original.id, ['2026-03-01']))

    const broken = incoming()
    broken.todos = [{ boom: () => undefined } as never]

    await expect(store.replaceAll(broken)).rejects.toThrow()

    const snapshot = await store.loadAll()
    expect(snapshot.definitions).toHaveLength(1)
    expect(snapshot.definitions[0]!.name).toBe('지켜져야 할 것')
    expect(snapshot.records).toHaveLength(1)
    expect(snapshot.settings.dayBoundaryHour).toBe(4)
  })
})

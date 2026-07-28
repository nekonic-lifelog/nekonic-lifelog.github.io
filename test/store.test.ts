import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { IdbStore } from '../src/data/idb'
import type { Snapshot } from '../src/data/store'
import { DEFAULT_SETTINGS } from '../src/lib/types'
import {
  dailyRecords,
  makeBook,
  makeDef,
  makeJournal,
  makeProject,
  resetIds,
} from './factories'

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

function openRaw(
  version: number,
  upgrade?: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('lifelog', version)
    if (upgrade) req.onupgradeneeded = () => upgrade(req.result)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('open이 blocked 되었습니다'))
  })
}

function putRaw(db: IDBDatabase, storeName: string, row: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
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
      projects: [],
      books: [],
      journal: [],
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

describe('프로젝트 · 독서 · 기록 테이블', () => {
  it('세 테이블도 쓴 것을 그대로 읽는다', async () => {
    const store = await freshStore()
    const project = makeProject({ name: '이사' })
    const book = makeBook({ title: '토지', defId: 'def-book' })
    const journal = makeJournal({ body: '첫 줄' })

    await store.put('projects', [project])
    await store.put('books', [book])
    await store.put('journal', [journal])

    const snapshot = await store.loadAll()
    expect(snapshot.projects).toEqual([project])
    expect(snapshot.books).toEqual([book])
    expect(snapshot.journal).toEqual([journal])
  })

  it('같은 날 여러 건의 기록을 나란히 담는다', async () => {
    const store = await freshStore()
    await store.put('journal', [
      makeJournal({ at: '2026-03-11T09:00:00+09:00', body: '아침' }),
      makeJournal({ at: '2026-03-11T21:00:00+09:00', kind: 'memo', body: '밤' }),
    ])
    const snapshot = await store.loadAll()
    expect(snapshot.journal).toHaveLength(2)
  })

  it('journal은 projectId로, books는 defId로 찾을 수 있다', async () => {
    const store = await freshStore()
    await store.put('journal', [makeJournal({ projectId: 'p-1' })])
    await store.put('books', [makeBook({ defId: 'd-1' })])

    const db = await openRaw(2)
    try {
      const tx = db.transaction(['journal', 'books'], 'readonly')
      const byProject = await new Promise<unknown[]>((resolve, reject) => {
        const req = tx.objectStore('journal').index('projectId').getAll('p-1')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      const byDef = await new Promise<unknown[]>((resolve, reject) => {
        const req = tx.objectStore('books').index('defId').getAll('d-1')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      expect(byProject).toHaveLength(1)
      expect(byDef).toHaveLength(1)
    } finally {
      db.close()
    }
  })
})

describe('스키마 올리기', () => {
  it('옛 DB를 열어도 기존 행이 남고 새 테이블은 비어 있다', async () => {
    const store = await freshStore()
    const def = makeDef({ name: '지켜져야 할 것' })

    const old = await openRaw(1, (db) => {
      for (const table of ['definitions', 'records', 'todos']) {
        db.createObjectStore(table, { keyPath: 'id' })
      }
      db.createObjectStore('meta', { keyPath: 'key' })
    })
    expect(old.version).toBe(1)
    await putRaw(old, 'definitions', def)
    await putRaw(old, 'meta', { key: 'deviceId', value: 'old-device' })
    old.close()

    const snapshot = await store.loadAll()
    expect(snapshot.definitions).toEqual([def])
    expect(snapshot.projects).toEqual([])
    expect(snapshot.books).toEqual([])
    expect(snapshot.journal).toEqual([])
    expect(await store.deviceId()).toBe('old-device')
  })

  it('올린 뒤에는 새 테이블에 바로 쓸 수 있다', async () => {
    const store = await freshStore()
    const old = await openRaw(1, (db) => {
      for (const table of ['definitions', 'records', 'todos']) {
        db.createObjectStore(table, { keyPath: 'id' })
      }
      db.createObjectStore('meta', { keyPath: 'key' })
    })
    await putRaw(old, 'todos', {
      id: 't-1',
      v: 1,
      createdAt: '2026-03-01T12:00:00+09:00',
      deviceId: 'old-device',
      updatedAt: '2026-03-01T12:00:00+09:00',
      deleted: false,
      title: '옛 할 일',
      status: 'todo',
      pinned: false,
    })
    old.close()

    await store.put('projects', [makeProject({ name: '새 프로젝트' })])

    const snapshot = await store.loadAll()
    expect(snapshot.todos).toHaveLength(1)
    expect(snapshot.projects).toHaveLength(1)
    expect(snapshot.projects[0]!.name).toBe('새 프로젝트')
  })
})

describe('replaceAll — 불러오기', () => {
  const incoming = (): Snapshot => {
    const def = makeDef({ name: '물' })
    return {
      definitions: [def],
      records: dailyRecords(def.id, ['2026-03-11']),
      todos: [],
      projects: [makeProject()],
      books: [],
      journal: [makeJournal()],
      settings: { ...DEFAULT_SETTINGS, dayBoundaryHour: 6 },
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

  it('새 세 테이블도 함께 갈아끼운다', async () => {
    const store = await freshStore()
    await store.put('projects', [makeProject({ name: '지워질 것' })])
    await store.put('books', [makeBook({ title: '지워질 책' })])
    await store.put('journal', [makeJournal({ body: '지워질 기록' })])

    await store.replaceAll(incoming())

    const snapshot = await store.loadAll()
    expect(snapshot.projects).toHaveLength(1)
    expect(snapshot.projects[0]!.name).toBe('이사 준비')
    expect(snapshot.books).toEqual([])
    expect(snapshot.journal).toHaveLength(1)
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

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { importDataKey, sealJson } from '../src/crypto/cipher'
import { randomBytes, toBase64 } from '../src/crypto/kdf'
import { IdbStore } from '../src/data/idb'
import type { RowTypes, Snapshot, Store, TableName } from '../src/data/store'
import { fixedClock, type Clock } from '../src/lib/clock'
import type { Base } from '../src/lib/types'
import { GithubRepo } from '../src/remote/github'
import type { RepoRef } from '../src/remote/types'
import { memorySyncCache } from '../src/sync/credentials'
import { SyncEngine } from '../src/sync/engine'
import { pathFor } from '../src/sync/paths'
import { makeDef, makeRecord, resetIds } from './factories'

const TOKEN = 'test-token-do-not-use'
const REPO: RepoRef = { owner: 'nekonic', repo: 'lifelog', branch: 'main' }
const NOW = '2026-03-12T20:00:00+09:00'
const COMMIT = 'c1'

let dataKey: CryptoKey
let clock: Clock

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function readOnlyRemote(files: Map<string, Uint8Array>): typeof fetch {
  return async (input) => {
    const url = String(input)
    if (url.endsWith(`/git/ref/heads/${REPO.branch}`)) {
      return json({ object: { sha: COMMIT } })
    }
    if (url.includes('/git/trees/')) {
      return json({
        truncated: false,
        tree: [...files].map(([path, bytes]) => ({
          path,
          sha: `blob-${path}`,
          type: 'blob',
          size: bytes.length,
        })),
      })
    }
    const blob = /\/git\/blobs\/(.+)$/.exec(url)
    if (blob) {
      const bytes = files.get(decodeURIComponent(blob[1] as string).slice('blob-'.length))
      if (bytes) return json({ encoding: 'base64', content: toBase64(bytes) })
    }
    return json({ message: '없는 경로입니다' }, 404)
  }
}

function remotePath(table: TableName, row: Base): string {
  return pathFor(table, row).slice(1)
}

const opened: IdbStore[] = []

async function freshStore(): Promise<IdbStore> {
  for (const store of opened) store.close()
  opened.length = 0
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('lifelog')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('deleteDatabase가 blocked 되었습니다'))
  })
  const store = new IdbStore()
  opened.push(store)
  return store
}

function writingAfterRead(inner: Store, intrude: () => Promise<void>): Store {
  let fired = false
  return {
    deviceId() {
      return inner.deviceId()
    },
    adoptDeviceId(id: string) {
      return inner.adoptDeviceId(id)
    },
    async loadAll() {
      const snapshot = await inner.loadAll()
      if (!fired) {
        fired = true
        await intrude()
      }
      return snapshot
    },
    put<K extends TableName>(table: K, rows: RowTypes[K][]) {
      return inner.put(table, rows)
    },
    putSettings(settings) {
      return inner.putSettings(settings)
    },
    replaceAll(snapshot: Snapshot) {
      return inner.replaceAll(snapshot)
    },
  }
}

interface Bench {
  store: IdbStore
  engine: SyncEngine
  mine: Base
  seen: Snapshot[]
}

async function bench(remoteRows: Base[] = []): Promise<Bench> {
  const store = await freshStore()
  const def = makeDef({ deviceId: 'pc', name: '아침 약' })
  const arrived = makeRecord(def.id, NOW, 1, { id: 'from-pc', deviceId: 'pc' })
  const files = new Map<string, Uint8Array>([
    [remotePath('definitions', def), await sealJson(dataKey, [def])],
    [remotePath('records', arrived), await sealJson(dataKey, [arrived, ...remoteRows])],
  ])

  const mine = makeRecord(def.id, NOW, 1, { id: 'during-pull', deviceId: 'phone' })
  const guarded = writingAfterRead(store, async () => {
    await store.put('records', [mine])
  })

  const seen: Snapshot[] = []
  const engine = new SyncEngine({
    store: guarded,
    repo: new GithubRepo(REPO, TOKEN, { fetch: readOnlyRemote(files), maxAttempts: 1 }),
    dataKey,
    deviceId: 'phone',
    clock,
    cache: memorySyncCache(),
    onSnapshot: (s) => seen.push(s),
  })
  return { store, engine, mine, seen }
}

function ids(rows: Base[]): string[] {
  return rows.map((row) => row.id).sort()
}

beforeEach(async () => {
  resetIds()
  dataKey = await importDataKey(randomBytes(32))
  clock = fixedClock(NOW)
})

describe('pull 도중에 들어온 기록', () => {
  it('읽은 뒤 쓰기 전에 끼어든 기록을 pull이 지우지 않는다', async () => {
    const { store, engine } = await bench()

    await engine.pull()

    expect(engine.state.lastError).toBeNull()
    const after = await store.loadAll()
    expect(ids(after.records)).toEqual(['during-pull', 'from-pc'])
  })

  it('pull이 넘기는 스냅숏에도 끼어든 기록이 들어 있다', async () => {
    const { store, engine, seen } = await bench()

    await engine.pull()

    expect(seen).toHaveLength(1)
    expect(ids(seen[0]?.records ?? [])).toEqual(['during-pull', 'from-pc'])

    await store.replaceAll(seen[0] as Snapshot)
    const after = await store.loadAll()
    expect(ids(after.records)).toEqual(['during-pull', 'from-pc'])
  })

  it('원격에서 온 tombstone은 지우지 않고 그대로 남긴다', async () => {
    const buried = makeRecord(makeDef({ deviceId: 'pc' }).id, NOW, 1, {
      id: 'buried',
      deviceId: 'pc',
      deleted: true,
    })
    const { store, engine } = await bench([buried])

    await engine.pull()

    const after = await store.loadAll()
    expect(ids(after.records)).toEqual(['buried', 'during-pull', 'from-pc'])
    expect(after.records.find((row) => row.id === 'buried')?.deleted).toBe(true)
  })

  it('원격이 더 새로우면 같은 id의 기록을 갱신한다', async () => {
    const store = await freshStore()
    const def = makeDef({ deviceId: 'pc' })
    const old = makeRecord(def.id, NOW, 1, { id: 'shared', deviceId: 'pc' })
    const fresh = { ...old, value: 7, updatedAt: '2026-03-12T21:00:00+09:00' }
    const files = new Map<string, Uint8Array>([
      [remotePath('definitions', def), await sealJson(dataKey, [def])],
      [remotePath('records', fresh), await sealJson(dataKey, [fresh])],
    ])
    await store.put('definitions', [def])
    await store.put('records', [old])

    const engine = new SyncEngine({
      store,
      repo: new GithubRepo(REPO, TOKEN, { fetch: readOnlyRemote(files), maxAttempts: 1 }),
      dataKey,
      deviceId: 'phone',
      clock,
      cache: memorySyncCache(),
    })
    await engine.pull()

    const after = await store.loadAll()
    expect(after.records).toHaveLength(1)
    expect(after.records[0]?.value).toBe(7)
  })
})

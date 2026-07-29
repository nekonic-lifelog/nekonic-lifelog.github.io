// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importDataKey, openJson, sealJson } from '../src/crypto/cipher'
import type { Envelope } from '../src/crypto/envelope'
import { fromBase64, randomBytes, toBase64 } from '../src/crypto/kdf'
import type { RowTypes, Snapshot, Store, TableName } from '../src/data/store'
import { fixedClock, mutableClock, type Clock } from '../src/lib/clock'
import type { ReminderFile } from '../src/lib/reminders'
import { DEFAULT_SETTINGS, type Base } from '../src/lib/types'
import { GithubRepo } from '../src/remote/github'
import { REDACTED } from '../src/remote/tokenScrub'
import type { RepoRef } from '../src/remote/types'
import { SyncProvider, useSync, type SyncApi, type SyncProviderProps } from '../src/state/sync'
import {
  memoryCredentials,
  memorySyncCache,
  type CredentialStore,
  type Credentials,
  type SyncCache,
} from '../src/sync/credentials'
import {
  HISTORY_LIMIT,
  SyncEngine,
  type SyncEngineOptions,
  type SyncState,
} from '../src/sync/engine'
import { mergeRows } from '../src/sync/merge'
import {
  makeBook,
  makeDef,
  makeJournal,
  makeProject,
  makeRecord,
  makeTodo,
  resetIds,
} from './factories'

Object.defineProperty(globalThis, 'Blob', {
  value: NodeBlob,
  configurable: true,
  writable: true,
})

const TOKEN = 'test-token-do-not-use'
const REPO: RepoRef = { owner: 'nekonic', repo: 'lifelog', branch: 'main' }
const PREFIX = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}`
const NOW = '2026-03-12T20:00:00+09:00'
const TABLES: TableName[] = ['definitions', 'records', 'todos', 'projects', 'books', 'journal']

interface Fail {
  status: number
  body: string
}

interface Fake {
  fetch: typeof fetch
  sleep(ms: number): Promise<void>
  commitCount(): number
  blobReads: string[]
  treeReads: string[]
  requests: string[]
  offline: boolean
  unauthorized: boolean
  failWith: Fail | null
  truncate: Set<string>
  onPatch: (() => void) | null
  paths(): string[]
  shaAt(path: string): string | undefined
  bytesAt(path: string): Uint8Array | undefined
  inject(path: string, content: Uint8Array): void
}

function hash(text: string): string {
  let h = 0x811c9dc5
  for (const b of new TextEncoder().encode(text)) {
    h ^= b
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function decodeSegments(text: string): string {
  return text
    .split('/')
    .map((part) => decodeURIComponent(part))
    .join('/')
}

function fakeGithub(): Fake {
  const blobs = new Map<string, Uint8Array>()
  const trees = new Map<string, Map<string, string>>()
  const commits = new Map<string, { tree: string; parents: string[] }>()
  let head: string | null = null
  let commitSeq = 0

  const putBlob = (bytes: Uint8Array): string => {
    const sha = `b${hash(toBase64(bytes))}-${bytes.length}`
    blobs.set(sha, bytes)
    return sha
  }

  const putTree = (files: Map<string, string>): string => {
    const flat = [...files.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([p, s]) => `${p}=${s}`)
      .join('\n')
    const sha = `t${hash(flat)}`
    trees.set(sha, new Map(files))
    return sha
  }

  const filesOf = (commitSha: string | null): Map<string, string> => {
    if (commitSha === null) return new Map()
    const commit = commits.get(commitSha)
    if (!commit) return new Map()
    return new Map(trees.get(commit.tree) ?? new Map())
  }

  const isAncestor = (want: string, from: string): boolean => {
    const seen = new Set<string>()
    const stack = [from]
    while (stack.length > 0) {
      const cur = stack.pop() as string
      if (cur === want) return true
      if (seen.has(cur)) continue
      seen.add(cur)
      stack.push(...(commits.get(cur)?.parents ?? []))
    }
    return false
  }

  const fake: Fake = {
    blobReads: [],
    treeReads: [],
    requests: [],
    offline: false,
    unauthorized: false,
    failWith: null,
    truncate: new Set<string>(),
    onPatch: null,
    commitCount: () => commitSeq,
    sleep: async () => undefined,
    paths: () => [...filesOf(head).keys()].sort(),
    shaAt: (path) => filesOf(head).get(path),
    bytesAt: (path) => {
      const sha = filesOf(head).get(path)
      return sha === undefined ? undefined : blobs.get(sha)
    },
    inject: (path, content) => {
      const files = filesOf(head)
      files.set(path, putBlob(content))
      head = ((): string => {
        const sha = `c${++commitSeq}`
        commits.set(sha, { tree: putTree(files), parents: head === null ? [] : [head] })
        return sha
      })()
    },
    fetch: (async (input: unknown, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const rest = url.startsWith(PREFIX) ? url.slice(PREFIX.length) : url
      const [rawPath = '', query = ''] = rest.split('?')
      fake.requests.push(`${method} ${rawPath}`)

      if (fake.offline) throw new TypeError('fetch failed')
      if (fake.unauthorized) return reply({ message: 'Bad credentials' }, 401)
      if (fake.failWith) return reply({ message: fake.failWith.body }, fake.failWith.status)

      const body: Record<string, unknown> =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}

      if (method === 'GET' && rawPath === `/git/ref/heads/${REPO.branch}`) {
        return head === null ? reply({ message: 'Not Found' }, 404) : reply({ object: { sha: head } })
      }

      if (method === 'GET' && rawPath.startsWith('/git/trees/')) {
        const target = decodeSegments(rawPath.slice('/git/trees/'.length))
        fake.treeReads.push(target)
        const [base = '', sub = ''] = target.split(':')
        const commitSha = base === REPO.branch ? head : base
        if (commitSha === null || !commits.has(commitSha)) {
          return reply({ message: 'Not Found' }, 404)
        }
        const prefix = sub === '' ? '' : `${sub}/`
        const all = [...filesOf(commitSha).entries()]
          .filter(([path]) => path.startsWith(prefix))
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([path, sha]) => ({ path: path.slice(prefix.length), sha, size: 1, type: 'blob' }))
        const cut = fake.truncate.has(sub)
        return reply({ truncated: cut, tree: cut ? all.slice(0, 1) : all })
      }

      if (method === 'GET' && rawPath.startsWith('/git/commits/')) {
        const sha = decodeURIComponent(rawPath.slice('/git/commits/'.length))
        const commit = commits.get(sha)
        if (!commit) return reply({ message: 'Not Found' }, 404)
        return reply({ sha, tree: { sha: commit.tree } })
      }

      if (method === 'GET' && rawPath.startsWith('/git/blobs/')) {
        const sha = decodeURIComponent(rawPath.slice('/git/blobs/'.length))
        const bytes = blobs.get(sha)
        if (!bytes) return reply({ message: 'Not Found' }, 404)
        fake.blobReads.push(sha)
        return reply({ content: toBase64(bytes), encoding: 'base64' })
      }

      if (method === 'GET' && rawPath.startsWith('/contents/')) {
        const path = decodeSegments(rawPath.slice('/contents/'.length))
        expect(query).toBe(`ref=${REPO.branch}`)
        const sha = filesOf(head).get(path)
        const bytes = sha === undefined ? undefined : blobs.get(sha)
        if (!bytes) return reply({ message: 'Not Found' }, 404)
        return reply({ content: toBase64(bytes), encoding: 'base64' })
      }

      if (method === 'POST' && rawPath === '/git/blobs') {
        expect(body['encoding']).toBe('base64')
        return reply({ sha: putBlob(fromBase64(String(body['content']))) })
      }

      if (method === 'POST' && rawPath === '/git/trees') {
        const baseTree = body['base_tree']
        const files = new Map(
          typeof baseTree === 'string' ? (trees.get(baseTree) ?? new Map()) : new Map(),
        )
        for (const entry of (body['tree'] ?? []) as Array<{ path: string; sha: string }>) {
          files.set(entry.path, entry.sha)
        }
        return reply({ sha: putTree(files) })
      }

      if (method === 'POST' && rawPath === '/git/commits') {
        const sha = `c${++commitSeq}`
        commits.set(sha, {
          tree: String(body['tree']),
          parents: (body['parents'] ?? []) as string[],
        })
        return reply({ sha })
      }

      if (method === 'PATCH' && rawPath === `/git/refs/heads/${REPO.branch}`) {
        fake.onPatch?.()
        const next = String(body['sha'])
        if (head !== null && !isAncestor(head, next)) {
          return reply({ message: 'Update is not a fast forward' }, 422)
        }
        head = next
        return reply({ object: { sha: next } })
      }

      if (method === 'POST' && rawPath === '/git/refs') {
        head = String(body['sha'])
        return reply({ object: { sha: head } })
      }

      return reply({ message: `예상 밖 요청 ${method} ${rawPath}` }, 418)
    }) as unknown as typeof fetch,
  }
  return fake
}

interface Bench extends Store {
  peek(): Snapshot
  rows(table: TableName): Base[]
}

function emptySnapshot(): Snapshot {
  return {
    definitions: [],
    records: [],
    todos: [],
    projects: [],
    books: [],
    journal: [],
    settings: DEFAULT_SETTINGS,
  }
}

function memoryStore(id: string): Bench {
  let held = emptySnapshot()
  const copy = (s: Snapshot): Snapshot => ({
    definitions: [...s.definitions],
    records: [...s.records],
    todos: [...s.todos],
    projects: [...s.projects],
    books: [...s.books],
    journal: [...s.journal],
    settings: { ...s.settings },
  })
  return {
    async deviceId() {
      return id
    },
    async adoptDeviceId() {
      return undefined
    },
    async loadAll() {
      return copy(held)
    },
    async put<K extends TableName>(table: K, rows: RowTypes[K][]) {
      const byId = new Map((held[table] as Base[]).map((row) => [row.id, row]))
      for (const row of rows) byId.set(row.id, row)
      held = { ...held, [table]: [...byId.values()] }
    },
    async putSettings(settings) {
      held = { ...held, settings }
    },
    async replaceAll(next) {
      held = copy(next)
    },
    peek() {
      return copy(held)
    },
    rows(table) {
      return [...(held[table] as Base[])].sort((a, b) => (a.id < b.id ? -1 : 1))
    },
  }
}

interface Device {
  store: Bench
  engine: SyncEngine
  states: SyncState[]
}

let dataKey: CryptoKey
let clock: Clock

function device(
  fake: Fake,
  id: string,
  over: Partial<SyncEngineOptions> = {},
  maxAttempts = 3,
): Device {
  const store = memoryStore(id)
  const states: SyncState[] = []
  const repo = new GithubRepo(REPO, TOKEN, {
    fetch: fake.fetch,
    sleep: fake.sleep,
    maxAttempts,
  })
  const engine = new SyncEngine({
    store,
    repo,
    dataKey,
    deviceId: id,
    clock,
    debounceMs: 1000,
    cache: memorySyncCache(),
    onState: (s) => states.push(s),
    ...over,
  })
  return { store, engine, states }
}

async function remoteFiles(fake: Fake, key: CryptoKey = dataKey): Promise<Map<string, Base[]>> {
  const out = new Map<string, Base[]>()
  for (const path of fake.paths()) {
    if (!path.endsWith('.enc')) continue
    out.set(path, await openJson<Base[]>(key, fake.bytesAt(path) as Uint8Array))
  }
  return out
}

async function settle(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

async function until(check: () => boolean, times = 5000): Promise<void> {
  for (let i = 0; i < times; i++) {
    if (check()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error('기다리던 조건이 끝내 성립하지 않았습니다')
}

let watched: SyncApi | null = null

function Watch(): null {
  watched = useSync()
  return null
}

function api(): SyncApi {
  if (watched === null) throw new Error('SyncProvider가 아직 붙지 않았습니다')
  return watched
}

const deadFetch = (async () => {
  throw new TypeError('fetch failed')
}) as unknown as typeof fetch

function mountSync(
  fake: Fake,
  store: Bench,
  vault: CredentialStore,
  cache: SyncCache,
  over: Partial<SyncProviderProps> = {},
) {
  return render(
    createElement(SyncProvider, {
      store,
      clock,
      credentials: vault,
      cache,
      debounceMs: 1000,
      makeRepo: () =>
        new GithubRepo(REPO, TOKEN, { fetch: fake.fetch, sleep: fake.sleep, maxAttempts: 2 }),
      children: createElement(Watch),
      ...over,
    }),
  )
}

function deadRepo(fake: Fake): GithubRepo {
  return new GithubRepo(REPO, TOKEN, { fetch: deadFetch, sleep: fake.sleep, maxAttempts: 2 })
}

async function savedCreds(vault: CredentialStore): Promise<void> {
  const envelope: Envelope = { v: 1, wraps: [] }
  const creds: Credentials = { dataKey, envelope, token: TOKEN, remote: { ...REPO } }
  await vault.save(creds)
}

beforeEach(async () => {
  resetIds()
  watched = null
  dataKey = await importDataKey(randomBytes(32))
  clock = fixedClock(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('두 기기 왕복', () => {
  it('한 기기가 올린 것을 다른 기기가 그대로 받는다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const def = makeDef({ deviceId: 'phone', name: '물 마시기' })
    const record = makeRecord(def.id, NOW, 500, { deviceId: 'phone' })
    await phone.store.put('definitions', [def])
    await phone.store.put('records', [record])

    await phone.engine.push()

    const pc = device(fake, 'pc')
    await pc.engine.pull()

    expect(pc.store.rows('definitions')).toEqual([def])
    expect(pc.store.rows('records')).toEqual([record])
    expect(pc.engine.state.lastSuccessAt).toBe(new Date(clock.now()).toISOString())
  })

  it('각자 만든 항목이 서로 오가고 나면 두 기기가 같아진다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const pc = device(fake, 'pc')
    const mine = makeDef({ deviceId: 'phone', name: '아침 약' })
    const yours = makeDef({ deviceId: 'pc', name: '저녁 산책' })
    await phone.store.put('definitions', [mine])
    await pc.store.put('definitions', [yours])

    await phone.engine.push()
    await pc.engine.pull()
    await pc.engine.push()
    await phone.engine.pull()

    expect(phone.store.rows('definitions')).toEqual([mine, yours])
    expect(pc.store.rows('definitions')).toEqual([mine, yours])
  })
})

describe('자기 파일만 쓴다', () => {
  it('다른 기기의 파일을 건드리지 않는다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const pc = device(fake, 'pc')
    await phone.store.put('todos', [
      { ...makeProject({ deviceId: 'phone' }), title: '장보기', status: 'todo', pinned: false },
    ] as never)
    await pc.store.put('todos', [
      { ...makeProject({ deviceId: 'pc' }), title: '설거지', status: 'todo', pinned: false },
    ] as never)

    await pc.engine.push()
    const before = fake.shaAt('todos/pc.enc')

    await phone.engine.pull()
    await phone.engine.push()

    expect(fake.paths()).toEqual(['todos/pc.enc', 'todos/phone.enc'])
    expect(fake.shaAt('todos/pc.enc')).toBe(before)
  })

  it('같은 행이 두 기기 파일에 현재 버전으로 함께 들어가지 않는다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const pc = device(fake, 'pc')
    const shared = makeDef({ deviceId: 'phone', name: '스트레칭' })
    await phone.store.put('definitions', [shared])
    await phone.engine.push()

    await pc.engine.pull()
    await pc.store.put('definitions', [
      { ...shared, deviceId: 'pc', name: '스트레칭 10분', updatedAt: '2026-03-12T21:00:00+09:00' },
    ])
    await pc.engine.push()
    await phone.engine.pull()
    await phone.engine.push()

    const files = await remoteFiles(fake)
    expect([...files.keys()]).toEqual(['defs/pc.enc', 'defs/phone.enc'])

    const winners = mergeRows([...files.values()])
    const holders = new Map<string, string[]>()
    for (const [path, rows] of files) {
      for (const row of rows) {
        if (!winners.some((w) => w.id === row.id && w.updatedAt === row.updatedAt)) continue
        holders.set(row.id, [...(holders.get(row.id) ?? []), path])
      }
    }
    for (const [, paths] of holders) expect(paths).toHaveLength(1)
    expect(phone.store.rows('definitions')).toEqual(pc.store.rows('definitions'))
  })
})

describe('삭제', () => {
  it('지운 항목이 다른 기기에서 되살아나지 않고 파일도 지워지지 않는다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const def = makeDef({ deviceId: 'phone', name: '없앨 습관' })
    await phone.store.put('definitions', [def])
    await phone.engine.push()

    const pc = device(fake, 'pc')
    await pc.engine.pull()
    expect(pc.store.rows('definitions')).toHaveLength(1)

    await phone.store.put('definitions', [
      { ...def, deleted: true, updatedAt: '2026-03-12T21:00:00+09:00' },
    ])
    await phone.engine.push()

    expect(fake.paths()).toContain('defs/phone.enc')
    const tomb = await remoteFiles(fake)
    expect(tomb.get('defs/phone.enc')?.[0]?.deleted).toBe(true)

    await pc.engine.pull()
    expect(pc.store.rows('definitions')).toHaveLength(1)
    expect(pc.store.rows('definitions')[0]?.deleted).toBe(true)

    await pc.engine.push()
    await phone.engine.pull()
    expect(phone.store.rows('definitions')[0]?.deleted).toBe(true)
  })
})

describe('커밋 묶기', () => {
  it('여러 파일이 함께 바뀌어도 커밋은 한 건이다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const def = makeDef({ deviceId: 'phone' })
    await phone.store.put('definitions', [def])
    await phone.store.put('records', [makeRecord(def.id, NOW, 1, { deviceId: 'phone' })])
    await phone.store.put('journal', [
      makeJournal({ deviceId: 'phone', id: 'jrn-1' }),
      makeJournal({ deviceId: 'phone', id: 'jrn-2' }),
    ])

    await phone.engine.push()

    expect(fake.commitCount()).toBe(1)
    expect(fake.paths()).toEqual([
      'defs/phone.enc',
      'journal/2026-03/jrn-1.enc',
      'journal/2026-03/jrn-2.enc',
      'records/2026-03/2026-03-12/phone.enc',
    ])
  })

  it('올릴 것이 없으면 커밋하지 않는다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')

    await phone.engine.push()
    expect(fake.commitCount()).toBe(0)

    await phone.store.put('books', [makeBook({ deviceId: 'phone' })])
    await phone.engine.push()
    expect(fake.commitCount()).toBe(1)

    await phone.engine.push()
    await phone.engine.push()
    expect(fake.commitCount()).toBe(1)
  })
})

describe('트리 읽기', () => {
  it('두 번째 받기에서는 그대로인 파일을 다시 내려받지 않는다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const def = makeDef({ deviceId: 'phone' })
    await phone.store.put('definitions', [def])
    await phone.store.put('records', [makeRecord(def.id, NOW, 1, { deviceId: 'phone' })])
    await phone.engine.push()

    const pc = device(fake, 'pc')
    await pc.engine.pull()
    const first = fake.blobReads.length
    expect(first).toBe(2)

    await pc.engine.pull()
    expect(fake.blobReads).toHaveLength(first)
    expect(pc.store.rows('definitions')).toEqual([def])
  })

  it('최근 몇 달 밖의 기록은 첫 받기에서 빼고 나중에 채운다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const def = makeDef({ deviceId: 'phone' })
    const fresh = makeRecord(def.id, NOW, 1, { deviceId: 'phone' })
    const old = makeRecord(def.id, '2025-06-10T09:00:00+09:00', 2, { deviceId: 'phone' })
    await phone.store.put('definitions', [def])
    await phone.store.put('records', [fresh, old])
    await phone.engine.push()
    expect(fake.paths()).toContain('records/2025-06/2025-06-10/phone.enc')

    const pc = device(fake, 'pc')
    await pc.engine.pull()

    expect(pc.store.rows('records').map((r) => r.id)).toEqual([fresh.id])
    expect(pc.store.rows('definitions')).toEqual([def])
    expect(pc.engine.state.backfilling).toBeNull()

    pc.states.length = 0
    await pc.engine.backfill()

    expect(pc.states.some((s) => s.backfilling !== null)).toBe(true)
    expect(pc.engine.state.backfilling).toBeNull()
    expect(pc.store.rows('records').map((r) => r.id).sort()).toEqual([fresh.id, old.id].sort())
  })

  it('잘린 트리는 하위 경로로 나눠 다시 받는다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const def = makeDef({ deviceId: 'phone' })
    await phone.store.put('definitions', [def])
    await phone.store.put('records', [makeRecord(def.id, NOW, 1, { deviceId: 'phone' })])
    await phone.store.put('journal', [makeJournal({ deviceId: 'phone', id: 'jrn-9' })])
    await phone.engine.push()

    fake.truncate.add('')
    const pc = device(fake, 'pc')
    fake.treeReads.length = 0
    await pc.engine.pull()

    expect(fake.treeReads.filter((t) => t.includes(':'))).toHaveLength(6)
    expect(pc.store.rows('definitions')).toHaveLength(1)
    expect(pc.store.rows('records')).toHaveLength(1)
    expect(pc.store.rows('journal')).toHaveLength(1)
  })

  it('잘린 하위 경로는 달 단위로 한 번 더 나눈다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const def = makeDef({ deviceId: 'phone' })
    await phone.store.put('definitions', [def])
    await phone.store.put('records', [
      makeRecord(def.id, NOW, 1, { deviceId: 'phone' }),
      makeRecord(def.id, '2026-02-02T09:00:00+09:00', 2, { deviceId: 'phone' }),
    ])
    await phone.engine.push()

    fake.truncate.add('')
    fake.truncate.add('records')
    const pc = device(fake, 'pc')
    fake.treeReads.length = 0
    await pc.engine.pull()

    expect(fake.treeReads.some((t) => t.endsWith(':records/2026-02'))).toBe(true)
    expect(pc.store.rows('records')).toHaveLength(2)
  })
})

describe('디바운스', () => {
  it('여러 번 고쳐도 한 번만 올린다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const fake = fakeGithub()
    const phone = device(fake, 'phone', { debounceMs: 2000 })

    for (let i = 0; i < 5; i++) {
      await phone.store.put('projects', [makeProject({ deviceId: 'phone' })])
      phone.engine.markDirty()
    }
    expect(phone.engine.state.pendingCount).toBe(5)
    expect(fake.commitCount()).toBe(0)

    vi.advanceTimersByTime(1999)
    await settle(3)
    expect(fake.commitCount()).toBe(0)

    vi.advanceTimersByTime(1)
    await until(() => fake.commitCount() === 1 && phone.engine.state.pendingCount === 0)

    expect(fake.commitCount()).toBe(1)
    expect(phone.engine.state.pendingCount).toBe(0)
  })

  it('멈추면 기다리던 올리기가 사라진다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const fake = fakeGithub()
    const phone = device(fake, 'phone', { debounceMs: 2000 })
    await phone.store.put('projects', [makeProject({ deviceId: 'phone' })])
    phone.engine.markDirty()

    phone.engine.stop()
    vi.advanceTimersByTime(5000)
    await settle()

    expect(fake.commitCount()).toBe(0)
  })
})

describe('경합', () => {
  it('브랜치가 앞질러 가면 최신 head로 다시 짜서 올린다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    await phone.store.put('books', [makeBook({ deviceId: 'phone' })])
    await phone.engine.push()
    expect(fake.commitCount()).toBe(1)

    await phone.store.put('books', [makeBook({ deviceId: 'phone', id: 'bk-2' })])
    const other = await sealJson(dataKey, [makeProject({ deviceId: 'pc', id: 'pj-9' })])
    let first = true
    fake.onPatch = () => {
      if (!first) return
      first = false
      fake.inject('projects/pc.enc', other)
    }

    await phone.engine.push()

    expect(phone.engine.state.lastError).toBeNull()
    expect(fake.paths()).toEqual(['books/phone.enc', 'projects/pc.enc'])
    const files = await remoteFiles(fake)
    expect(files.get('books/phone.enc')).toHaveLength(2)
    expect(files.get('projects/pc.enc')?.[0]?.id).toBe('pj-9')
  })
})

describe('알림 파일', () => {
  const PATH = 'meta/reminders/phone.json'
  const DUE = '2026-03-14T14:00:00+09:00'

  const textAt = (fake: Fake, path: string): string =>
    new TextDecoder().decode(fake.bytesAt(path) as Uint8Array)

  const readFile = (fake: Fake): ReminderFile =>
    JSON.parse(textAt(fake, PATH)) as ReminderFile

  it('같은 커밋에 평문 JSON으로 들어간다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const todo = makeTodo({ deviceId: 'phone', title: '병원 예약', dueAt: DUE })
    await phone.store.put('todos', [todo])

    await phone.engine.push()

    expect(fake.commitCount()).toBe(1)
    expect(fake.paths()).toEqual([PATH, 'todos/phone.enc'])

    const file = readFile(fake)
    expect(file.tz).toBe('Asia/Seoul')
    expect(file.recurring).toEqual([])
    expect(file.events).toEqual([
      {
        id: todo.id,
        at: DUE,
        label: '병원 예약',
        offsets: [2880, 1440, 120, 60],
        channel: 'discord',
      },
    ])
  })

  it('프로젝트 작업 제목은 올라간 파일에 나타나지 않는다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    await phone.store.put('todos', [
      makeTodo({
        deviceId: 'phone',
        title: '3분기 매출 점검 회의',
        projectId: 'pj-1',
        dueAt: DUE,
      }),
    ])

    await phone.engine.push()

    expect(textAt(fake, PATH)).not.toContain('3분기 매출 점검 회의')
    expect(readFile(fake).events[0]?.label).toBe('업무')
  })

  it('내용이 그대로면 다음 올리기에 넣지 않는다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    await phone.store.put('todos', [makeTodo({ deviceId: 'phone', dueAt: DUE })])
    await phone.engine.push()

    fake.inject(PATH, new TextEncoder().encode('밖에서 손댄 것'))
    await phone.store.put('books', [makeBook({ deviceId: 'phone', id: 'bk-2' })])
    await phone.engine.push()

    expect(fake.paths()).toContain('books/phone.enc')
    expect(textAt(fake, PATH)).toBe('밖에서 손댄 것')
  })

  it('내용이 바뀌면 다시 올린다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const todo = makeTodo({ deviceId: 'phone', dueAt: DUE })
    await phone.store.put('todos', [todo])
    await phone.engine.push()
    expect(readFile(fake).events).toHaveLength(1)

    await phone.store.put('todos', [
      { ...todo, status: 'done', updatedAt: '2026-03-12T21:00:00+09:00' },
    ])
    await phone.engine.push()

    expect(readFile(fake).events).toEqual([])
  })

  it('다른 기기의 알림 파일을 건드리지 않는다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const theirs = '{"tz":"Asia/Seoul","recurring":[],"events":[]}\n'
    fake.inject('meta/reminders/pc.json', new TextEncoder().encode(theirs))
    const before = fake.shaAt('meta/reminders/pc.json')

    await phone.store.put('todos', [makeTodo({ deviceId: 'phone', dueAt: DUE })])
    await phone.engine.push()

    expect(fake.paths()).toContain(PATH)
    expect(fake.shaAt('meta/reminders/pc.json')).toBe(before)
    expect(textAt(fake, 'meta/reminders/pc.json')).toBe(theirs)
  })

  it('알릴 것이 하나도 없으면 파일을 만들지 않고 나머지는 그대로 올린다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    await phone.store.put('books', [makeBook({ deviceId: 'phone' })])

    await phone.engine.push()

    expect(fake.commitCount()).toBe(1)
    expect(fake.paths()).toEqual(['books/phone.enc'])
    expect(phone.engine.state.lastError).toBeNull()
  })

  it('마감이 지나 소용없어진 이벤트는 파일에서 사라진다', async () => {
    const fake = fakeGithub()
    const tick = mutableClock(NOW)
    clock = tick
    const phone = device(fake, 'phone')
    await phone.store.put('todos', [makeTodo({ deviceId: 'phone', dueAt: DUE })])
    await phone.engine.push()
    expect(readFile(fake).events).toHaveLength(1)

    tick.advanceDays(5)
    await phone.engine.push()

    expect(readFile(fake).events).toEqual([])
  })
})

describe('인증과 연결', () => {
  it('토큰이 막히면 알리고 더 두드리지 않는다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    await phone.store.put('books', [makeBook({ deviceId: 'phone' })])

    fake.unauthorized = true
    await phone.engine.push()

    expect(phone.engine.state.authFailed).toBe(true)
    expect(phone.engine.state.phase).toBe('error')
    expect(phone.engine.state.lastError).toMatch(/토큰/)
    expect(phone.engine.state.lastError).not.toContain(TOKEN)

    const after = fake.requests.length
    await phone.engine.push()
    await phone.engine.pull()
    await phone.engine.syncNow()
    expect(fake.requests).toHaveLength(after)
    expect(fake.commitCount()).toBe(0)
  })

  it('망이 끊긴 것은 인증 실패로 치지 않고 다음 기회에 올린다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone', {}, 2)
    await phone.store.put('books', [makeBook({ deviceId: 'phone' })])
    phone.engine.markDirty()
    phone.engine.markDirty()

    fake.offline = true
    await phone.engine.push()

    expect(phone.engine.state.authFailed).toBe(false)
    expect(phone.engine.state.phase).toBe('idle')
    expect(phone.engine.state.lastError).not.toBeNull()
    expect(phone.engine.state.pendingCount).toBe(2)
    expect(phone.engine.state.lastSuccessAt).toBeNull()

    fake.offline = false
    await phone.engine.push()

    expect(fake.commitCount()).toBe(1)
    expect(phone.engine.state.pendingCount).toBe(0)
    expect(phone.engine.state.lastError).toBeNull()
    expect(phone.engine.state.lastSuccessAt).not.toBeNull()
  })

  it('오류 글귀 어디에도 토큰이 남지 않는다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone', {}, 2)
    await phone.store.put('books', [makeBook({ deviceId: 'phone' })])

    fake.failWith = { status: 500, body: `무너짐 Bearer ${TOKEN}` }
    await phone.engine.push()

    const shown = String(phone.engine.state.lastError)
    expect(shown).not.toContain(TOKEN)
    expect(shown).toContain(REDACTED)
    expect(fake.requests.every((r) => !r.includes(TOKEN))).toBe(true)
  })
})

describe('상태 알리기', () => {
  it('고칠 때마다 대기 건수가 늘고 올리고 나면 0이 된다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone', { debounceMs: 600_000 })
    await phone.store.put('books', [makeBook({ deviceId: 'phone' })])

    expect(phone.engine.state.pendingCount).toBe(0)
    phone.engine.markDirty()
    expect(phone.engine.state.pendingCount).toBe(1)
    phone.engine.markDirty()
    phone.engine.markDirty()
    expect(phone.engine.state.pendingCount).toBe(3)

    await phone.engine.push()
    expect(phone.engine.state.pendingCount).toBe(0)
    expect(phone.states.map((s) => s.phase)).toContain('pushing')
    phone.engine.stop()
  })

  it('마지막 성공 시각은 성공했을 때만 움직인다', async () => {
    const fake = fakeGithub()
    const tick = mutableClock(NOW)
    clock = tick
    const phone = device(fake, 'phone', {}, 2)
    await phone.store.put('books', [makeBook({ deviceId: 'phone' })])

    fake.offline = true
    await phone.engine.push()
    expect(phone.engine.state.lastSuccessAt).toBeNull()

    fake.offline = false
    await phone.engine.push()
    const good = phone.engine.state.lastSuccessAt
    expect(good).toBe(new Date(tick.now()).toISOString())

    tick.advanceHours(2)
    fake.offline = true
    await phone.engine.pull()
    expect(phone.engine.state.lastSuccessAt).toBe(good)
  })

  it('열지 못한 파일 하나가 나머지 동기화를 죽이지 않는다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const def = makeDef({ deviceId: 'phone' })
    await phone.store.put('definitions', [def])
    await phone.engine.push()

    const stranger = await importDataKey(randomBytes(32))
    fake.inject('todos/ghost.enc', await sealJson(stranger, [makeProject({ id: 'pj-x' })]))

    const pc = device(fake, 'pc')
    await pc.engine.pull()

    expect(pc.store.rows('definitions')).toEqual([def])
    expect(pc.store.rows('todos')).toEqual([])
    expect(pc.engine.state.authFailed).toBe(false)
    expect(pc.engine.state.lastError).toContain('todos/ghost.enc')
    expect(pc.engine.state.skipped).toEqual(['/todos/ghost.enc'])
    expect(pc.engine.state.lastAttemptAt).not.toBeNull()
    expect(pc.engine.state.lastSuccessAt).toBeNull()
    expect(pc.engine.state.history[0]?.outcome).toBe('partial')
  })

  it('한 번에 받고 올리는 길에서도 모든 테이블이 오간다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const def = makeDef({ deviceId: 'phone' })
    await phone.store.put('definitions', [def])
    await phone.store.put('records', [makeRecord(def.id, NOW, 1, { deviceId: 'phone' })])
    await phone.store.put('projects', [makeProject({ deviceId: 'phone' })])
    await phone.store.put('books', [makeBook({ deviceId: 'phone' })])
    await phone.store.put('journal', [makeJournal({ deviceId: 'phone', id: 'jrn-3' })])
    await phone.engine.syncNow()

    const pc = device(fake, 'pc')
    await pc.engine.syncNow()

    for (const table of TABLES) {
      expect(pc.store.rows(table)).toEqual(phone.store.rows(table))
    }
    expect(fake.commitCount()).toBe(1)
  })
})

describe('동기화 이력', () => {
  it('받기와 올리기가 방향과 파일 수까지 남는다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const def = makeDef({ deviceId: 'phone' })
    await phone.store.put('definitions', [def])
    await phone.engine.push()

    const pc = device(fake, 'pc')
    await pc.engine.pull()

    const up = phone.engine.state.history[0]
    expect(up?.direction).toBe('push')
    expect(up?.outcome).toBe('ok')
    expect(up?.wrote).toBeGreaterThan(0)
    expect(up?.read).toBe(0)
    expect(up?.at).toBe(new Date(clock.now()).toISOString())

    const down = pc.engine.state.history[0]
    expect(down?.direction).toBe('pull')
    expect(down?.outcome).toBe('ok')
    expect(down?.read).toBe(1)
    expect(down?.wrote).toBe(0)
    expect(down?.error).toBeNull()
  })

  it('이력은 최근 스무 건만 남고 오래된 것은 밀려난다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    await phone.store.put('books', [makeBook({ deviceId: 'phone', id: 'bk-1' })])

    for (let i = 0; i < HISTORY_LIMIT + 5; i++) await phone.engine.pull()

    expect(phone.engine.state.history).toHaveLength(HISTORY_LIMIT)
    expect(phone.engine.state.history.every((e) => e.direction === 'pull')).toBe(true)

    await phone.engine.push()
    expect(phone.engine.state.history).toHaveLength(HISTORY_LIMIT)
    expect(phone.engine.state.history[0]?.direction).toBe('push')
    expect(phone.engine.state.history.filter((e) => e.direction === 'push')).toHaveLength(1)
  })

  it('성공과 실패가 이력에서 구분된다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone', {}, 2)
    await phone.store.put('books', [makeBook({ deviceId: 'phone' })])

    fake.offline = true
    await phone.engine.push()
    fake.offline = false
    await phone.engine.push()

    const outcomes = phone.engine.state.history.map((e) => e.outcome)
    expect(outcomes).toEqual(['ok', 'failed'])
    expect(phone.engine.state.history[1]?.error).not.toBeNull()
    expect(phone.engine.state.history[0]?.error).toBeNull()
  })

  it('부분 실패는 완전 성공과 구분되고 마지막 성공 시각을 움직이지 않는다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const def = makeDef({ deviceId: 'phone' })
    await phone.store.put('definitions', [def])
    await phone.engine.push()

    const pc = device(fake, 'pc')
    await pc.engine.pull()
    const clean = pc.engine.state.lastSuccessAt
    expect(clean).not.toBeNull()
    expect(pc.engine.state.history[0]?.outcome).toBe('ok')

    const stranger = await importDataKey(randomBytes(32))
    fake.inject('books/ghost.enc', await sealJson(stranger, [makeBook({ id: 'bk-x' })]))
    await pc.engine.pull()

    expect(pc.engine.state.history[0]?.outcome).toBe('partial')
    expect(pc.engine.state.history[0]?.skipped).toBe(1)
    expect(pc.engine.state.lastSuccessAt).toBe(clean)
    expect(pc.engine.state.lastAttemptAt).not.toBe(null)
  })

  it('여러 파일이 열리지 않으면 개수가 함께 보인다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const def = makeDef({ deviceId: 'phone' })
    await phone.store.put('definitions', [def])
    await phone.engine.push()

    const stranger = await importDataKey(randomBytes(32))
    for (const name of ['aa', 'bb', 'cc', 'dd']) {
      fake.inject(`books/${name}.enc`, await sealJson(stranger, [makeBook({ id: `bk-${name}` })]))
    }

    const pc = device(fake, 'pc')
    await pc.engine.pull()

    expect(pc.engine.state.skipped).toHaveLength(4)
    expect(pc.engine.state.history[0]?.skipped).toBe(4)
    expect(pc.engine.state.lastError).toContain('4')
    expect(pc.engine.state.lastError).toContain('books/aa.enc')
    expect(pc.engine.state.lastError).toContain('외 1개')
    expect(pc.store.rows('definitions')).toEqual([def])
  })
})

describe('첫 동기화 진행도', () => {
  it('백필 진행도가 0에서 시작해 총 개수까지 올라간다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const def = makeDef({ deviceId: 'phone' })
    await phone.store.put('definitions', [def])
    await phone.store.put('records', [
      makeRecord(def.id, '2025-04-10T09:00:00+09:00', 1, { deviceId: 'phone' }),
      makeRecord(def.id, '2025-05-10T09:00:00+09:00', 2, { deviceId: 'phone' }),
      makeRecord(def.id, '2025-06-10T09:00:00+09:00', 3, { deviceId: 'phone' }),
    ])
    await phone.engine.push()

    const pc = device(fake, 'pc')
    await pc.engine.pull()

    pc.states.length = 0
    await pc.engine.backfill()

    const seen = pc.states
      .map((s) => s.backfilling)
      .filter((b): b is { done: number; total: number } => b !== null)
    const total = seen[seen.length - 1]?.total ?? 0
    expect(total).toBe(3)
    expect(seen[0]).toEqual({ done: 0, total: 0 })
    expect(seen).toContainEqual({ done: 0, total })
    expect(seen).toContainEqual({ done: total, total })

    const steps = seen.filter((b) => b.total === total).map((b) => b.done)
    expect(steps).toEqual([...steps].sort((a, b) => a - b))
    expect(pc.engine.state.backfilling).toBeNull()
    expect(pc.store.rows('records')).toHaveLength(3)
  })
})

describe('겹친 편집', () => {
  const LATER = '2026-03-12T21:00:00+09:00'
  const LATEST = '2026-03-12T22:00:00+09:00'

  async function crossed(): Promise<Device> {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const pc = device(fake, 'pc')
    const book = makeBook({ deviceId: 'phone', id: 'bk-1', title: '처음 제목' })
    await phone.store.put('books', [book])
    await phone.engine.push()
    await pc.engine.pull()

    await phone.store.put('books', [
      { ...book, deviceId: 'phone', updatedAt: LATER, title: '폰에서 고친 제목' },
    ])
    await pc.store.put('books', [
      { ...book, deviceId: 'pc', updatedAt: LATEST, title: 'PC에서 고친 제목' },
    ])
    await phone.engine.push()
    await pc.engine.push()
    await phone.engine.pull()
    return phone
  }

  it('두 기기가 같은 항목을 고치면 밀린 쪽이 남는다', async () => {
    const phone = await crossed()

    expect(phone.engine.state.clashes).toHaveLength(1)
    expect(phone.engine.state.clashes[0]).toEqual({
      table: 'books',
      id: 'bk-1',
      winnerDeviceId: 'pc',
      loserDeviceId: 'phone',
      loserUpdatedAt: LATER,
    })
    expect(phone.store.rows('books')[0]?.deviceId).toBe('pc')
  })

  it('겹친 편집 자국에 본문이 들어 있지 않다', async () => {
    const phone = await crossed()
    const dump = JSON.stringify(phone.engine.state.clashes)

    expect(dump).not.toContain('폰에서 고친 제목')
    expect(dump).not.toContain('PC에서 고친 제목')
    expect(dump).not.toContain('처음 제목')
    expect(dump).not.toContain('title')
    for (const clash of phone.engine.state.clashes) {
      expect(Object.keys(clash).sort()).toEqual([
        'id',
        'loserDeviceId',
        'loserUpdatedAt',
        'table',
        'winnerDeviceId',
      ])
    }
  })

  it('겹치지 않은 편집은 기록되지 않는다', async () => {
    const fake = fakeGithub()
    const phone = device(fake, 'phone')
    const pc = device(fake, 'pc')
    const mine = makeBook({ deviceId: 'phone', id: 'bk-1', title: '내 것' })
    const yours = makeBook({ deviceId: 'pc', id: 'bk-2', title: '네 것' })
    await phone.store.put('books', [mine])
    await pc.store.put('books', [yours])
    await phone.engine.push()
    await pc.engine.push()

    await phone.store.put('books', [{ ...mine, updatedAt: LATER, title: '나만 고침' }])
    await phone.engine.push()
    await phone.engine.pull()
    await pc.engine.pull()

    expect(phone.engine.state.clashes).toEqual([])
    expect(pc.engine.state.clashes).toEqual([])
    expect(pc.store.rows('books')).toHaveLength(2)
  })
})

describe('앱을 다시 열 때', () => {
  it('망이 끊겨 못 올린 변경이 다시 열 때 올라간다', async () => {
    const fake = fakeGithub()
    const vault = memoryCredentials()
    const cache = memorySyncCache()
    const store = memoryStore('phone')
    await savedCreds(vault)
    await store.put('books', [makeBook({ deviceId: 'phone', id: 'bk-1' })])

    const first = mountSync(fake, store, vault, cache, { makeRepo: () => deadRepo(fake) })
    await until(() => watched?.state.lastError != null)
    expect(fake.requests).toEqual([])
    first.unmount()

    const second = mountSync(fake, store, vault, cache)
    await until(() => fake.paths().includes('books/phone.enc'))
    await api().syncNow()
    second.unmount()

    const files = await remoteFiles(fake)
    expect(files.get('books/phone.enc')).toHaveLength(1)
    expect(fake.commitCount()).toBe(1)
  })

  it('올릴 것이 없으면 다시 열어도 쓰기 요청을 만들지 않는다', async () => {
    const fake = fakeGithub()
    const vault = memoryCredentials()
    const cache = memorySyncCache()
    const store = memoryStore('phone')
    await savedCreds(vault)
    await store.put('books', [makeBook({ deviceId: 'phone', id: 'bk-1' })])

    const first = mountSync(fake, store, vault, cache)
    await until(() => fake.paths().includes('books/phone.enc'))
    await api().syncNow()
    first.unmount()

    const mark = fake.requests.length
    const second = mountSync(fake, store, vault, cache)
    await until(() => watched?.state.lastSuccessAt != null)
    await api().syncNow()
    second.unmount()

    const after = fake.requests.slice(mark)
    expect(after.length).toBeGreaterThan(0)
    expect(after.filter((r) => !r.startsWith('GET '))).toEqual([])
    expect(fake.commitCount()).toBe(1)
  })

  it('망이 돌아오면 못 올린 변경을 다시 올린다', async () => {
    const fake = fakeGithub()
    const vault = memoryCredentials()
    const cache = memorySyncCache()
    const store = memoryStore('phone')
    await savedCreds(vault)
    await store.put('books', [makeBook({ deviceId: 'phone', id: 'bk-1' })])

    const view = mountSync(fake, store, vault, cache)
    await until(() => fake.paths().includes('books/phone.enc'))
    await api().syncNow()
    expect(fake.commitCount()).toBe(1)

    await store.put('books', [makeBook({ deviceId: 'phone', id: 'bk-2' })])
    window.dispatchEvent(new Event('online'))
    await until(() => fake.commitCount() === 2)
    view.unmount()

    const files = await remoteFiles(fake)
    expect(files.get('books/phone.enc')).toHaveLength(2)
  })

  it('화면이 다시 보이면 못 올린 변경을 다시 올린다', async () => {
    const fake = fakeGithub()
    const vault = memoryCredentials()
    const cache = memorySyncCache()
    const store = memoryStore('phone')
    await savedCreds(vault)
    await store.put('books', [makeBook({ deviceId: 'phone', id: 'bk-1' })])

    const view = mountSync(fake, store, vault, cache)
    await until(() => fake.paths().includes('books/phone.enc'))
    await api().syncNow()

    await store.put('books', [makeBook({ deviceId: 'phone', id: 'bk-2' })])
    expect(document.visibilityState).toBe('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await until(() => fake.commitCount() === 2)
    view.unmount()

    const files = await remoteFiles(fake)
    expect(files.get('books/phone.enc')).toHaveLength(2)
  })

  it('토큰이 막힌 뒤에는 망이 돌아와도 두드리지 않는다', async () => {
    const fake = fakeGithub()
    const vault = memoryCredentials()
    const cache = memorySyncCache()
    const store = memoryStore('phone')
    await savedCreds(vault)
    await store.put('books', [makeBook({ deviceId: 'phone', id: 'bk-1' })])

    fake.unauthorized = true
    const view = mountSync(fake, store, vault, cache)
    await until(() => watched?.state.authFailed === true)

    fake.unauthorized = false
    const mark = fake.requests.length
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()

    expect(fake.requests).toHaveLength(mark)
    expect(fake.paths()).toEqual([])
    expect(fake.commitCount()).toBe(0)
    view.unmount()
  })

  it('언마운트하면 붙였던 리스너가 남지 않는다', async () => {
    const fake = fakeGithub()
    const vault = memoryCredentials()
    const cache = memorySyncCache()
    const store = memoryStore('phone')
    await savedCreds(vault)
    await store.put('books', [makeBook({ deviceId: 'phone', id: 'bk-1' })])

    const added: Array<{ type: string; fn: unknown }> = []
    const removed: Array<{ type: string; fn: unknown }> = []
    for (const target of [window, document] as EventTarget[]) {
      const add = target.addEventListener.bind(target)
      const drop = target.removeEventListener.bind(target)
      vi.spyOn(target, 'addEventListener').mockImplementation((type, fn, opts) => {
        added.push({ type, fn })
        add(type, fn, opts)
      })
      vi.spyOn(target, 'removeEventListener').mockImplementation((type, fn, opts) => {
        removed.push({ type, fn })
        drop(type, fn, opts)
      })
    }

    const view = mountSync(fake, store, vault, cache)
    await until(() => fake.paths().includes('books/phone.enc'))
    await api().syncNow()

    const mine = added.filter((e) => e.type === 'online' || e.type === 'visibilitychange')
    expect(mine.map((e) => e.type).sort()).toEqual(['online', 'visibilitychange'])

    view.unmount()
    for (const entry of mine) expect(removed).toContainEqual(entry)

    await store.put('books', [makeBook({ deviceId: 'phone', id: 'bk-2' })])
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()

    expect(fake.commitCount()).toBe(1)
  })
})


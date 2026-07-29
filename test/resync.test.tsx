// @vitest-environment jsdom
import { createElement, useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { Snapshot, Store } from '../src/data/store'
import { fixedClock } from '../src/lib/clock'
import { DEFAULT_SETTINGS } from '../src/lib/types'
import { AppProvider } from '../src/state/app'
import { SyncProvider, useSync } from '../src/state/sync'
import { createEnvelope, openEnvelope } from '../src/crypto/envelope'
import { emptyCache, type Credentials, type CredentialStore, type SyncCache, type SyncCacheData } from '../src/sync/credentials'

const NOW = '2026-07-30T09:00:00+09:00'
const TOKEN = 'test-token-do-not-use'

function snap(): Snapshot {
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

function memoryStore(): Store {
  const data = snap()
  return {
    deviceId: async () => 'test-device',
    adoptDeviceId: async () => undefined,
    loadAll: async () => data,
    put: async () => undefined,
    putSettings: async () => undefined,
    replaceAll: async () => undefined,
  }
}

function memoryCache(seed: SyncCacheData): SyncCache & { current: SyncCacheData; cleared: number } {
  const box = {
    current: seed,
    cleared: 0,
    async load() {
      return box.current
    },
    async save(data: SyncCacheData) {
      box.current = data
    },
    async clear() {
      box.cleared += 1
      box.current = emptyCache()
    },
  }
  return box
}

function memoryVault(saved: Credentials | null): CredentialStore {
  let held = saved
  return {
    async load() {
      return held
    },
    async save(creds: Credentials) {
      held = creds
    },
    async clear() {
      held = null
    },
  }
}

function Probe({ onReady }: { onReady(api: ReturnType<typeof useSync>): void }) {
  const sync = useSync()
  useEffect(() => {
    onReady(sync)
  }, [sync, onReady])
  return createElement('span', null, sync.connected ? '이음' : '끊김')
}

function fakeRepo(written: string[]) {
  return {
    async readTextFile() {
      return null
    },
    async commitWithRetry(plan: () => Promise<{ put: { path: string }[] }>) {
      const p = await plan()
      for (const f of p.put) written.push(f.path)
    },
    async readTree() {
      return { sha: '', entries: [] }
    },
    async readBlob() {
      return new Uint8Array()
    },
  }
}

function mount(cache: SyncCache, vault: CredentialStore, written: string[] = []) {
  let api: ReturnType<typeof useSync> | null = null
  const view = render(
    createElement(AppProvider, {
      store: memoryStore(),
      clock: fixedClock(NOW),
      children: createElement(SyncProvider, {
        store: memoryStore(),
        clock: fixedClock(NOW),
        credentials: vault,
        cache,
        makeRepo: () => fakeRepo(written) as never,
        autoConnect: false,
        autoBackfill: false,
        children: createElement(Probe, {
          onReady: (a) => {
            api = a
          },
        }),
      }),
    }),
  )
  return { view, api: () => api! }
}

const seeded = (): SyncCacheData => ({
  commitSha: 'abc123',
  blobs: { 'todos/dev.enc': 'sha-1' },
  pushed: { 'todos/dev.enc': 'sha-1' },
  backfilled: true,
  reminders: null,
})

afterEach(cleanup)

describe('암호구절 더하기 — 옛 것을 지우기 전에 새 것을 확인한다', () => {
  it('현재 암호구절이 맞아야 새 것을 더한다', async () => {
    const made = await createEnvelope('current-do-not-use', 'pbkdf2')
    const cache = memoryCache(seeded())
    const vault = memoryVault({
      remote: { owner: 'me', repo: 'lifelog-data', branch: 'main' },
      token: TOKEN,
      dataKey: made.dataKey,
      envelope: made.envelope,
    })
    const written: string[] = []
    const { api } = mount(cache, vault, written)

    await waitFor(() => expect(api()).not.toBeNull())
    await api().addPassphrase('current-do-not-use', 'next-do-not-use')

    const saved = await vault.load()
    expect(saved!.envelope.wraps).toHaveLength(2)
    await expect(openEnvelope(saved!.envelope, 'current-do-not-use')).resolves.toBeTruthy()
    await expect(openEnvelope(saved!.envelope, 'next-do-not-use')).resolves.toBeTruthy()
  })

  it('새 봉투를 저장소에도 올린다', async () => {
    const made = await createEnvelope('current-do-not-use', 'pbkdf2')
    const cache = memoryCache(seeded())
    const vault = memoryVault({
      remote: { owner: 'me', repo: 'lifelog-data', branch: 'main' },
      token: TOKEN,
      dataKey: made.dataKey,
      envelope: made.envelope,
    })
    const written: string[] = []
    const { api } = mount(cache, vault, written)

    await waitFor(() => expect(api()).not.toBeNull())
    await api().addPassphrase('current-do-not-use', 'next-do-not-use')

    expect(written).toContain('meta/envelope.json')
  })

  it('현재 암호구절이 틀리면 아무것도 바뀌지 않는다', async () => {
    const made = await createEnvelope('current-do-not-use', 'pbkdf2')
    const cache = memoryCache(seeded())
    const vault = memoryVault({
      remote: { owner: 'me', repo: 'lifelog-data', branch: 'main' },
      token: TOKEN,
      dataKey: made.dataKey,
      envelope: made.envelope,
    })
    const written: string[] = []
    const { api } = mount(cache, vault, written)

    await waitFor(() => expect(api()).not.toBeNull())
    await expect(api().addPassphrase('wrong-do-not-use', 'next-do-not-use')).rejects.toThrow()

    const saved = await vault.load()
    expect(saved!.envelope.wraps).toHaveLength(1)
    expect(written).toHaveLength(0)
  })

  it('이어 있지 않으면 더할 수 없다', async () => {
    const cache = memoryCache(seeded())
    const { api } = mount(cache, memoryVault(null), [])

    await waitFor(() => expect(api()).not.toBeNull())
    await expect(api().addPassphrase('a-do-not-use', 'b-do-not-use')).rejects.toThrow()
  })
})

describe('전부 다시 받기 — 캐시를 지울 수단', () => {
  it('연결을 끊으면 읽음 표시도 함께 지운다', async () => {
    const cache = memoryCache(seeded())
    const { api } = mount(cache, memoryVault(null))

    await waitFor(() => expect(api()).not.toBeNull())
    await api().disconnect()

    expect(cache.cleared).toBeGreaterThan(0)
    expect(cache.current.backfilled).toBe(false)
    expect(cache.current.commitSha).toBe('')
    expect(Object.keys(cache.current.blobs)).toHaveLength(0)
  })

  it('전부 다시 받기는 읽음 표시만 지우고 자격은 남긴다', async () => {
    const cache = memoryCache(seeded())
    const vault = memoryVault({
      remote: { owner: 'me', repo: 'lifelog-data', branch: 'main' },
      token: TOKEN,
      dataKey: {} as CryptoKey,
      envelope: { v: 1, wraps: [] },
    })
    const { api } = mount(cache, vault)

    await waitFor(() => expect(api()).not.toBeNull())
    await api().resyncAll()

    expect(cache.current.backfilled).toBe(false)
    expect(Object.keys(cache.current.blobs)).toHaveLength(0)
    expect(await vault.load()).not.toBeNull()
  })

  it('자격이 없으면 전부 다시 받기를 해도 조용히 지나간다', async () => {
    const cache = memoryCache(seeded())
    const { api } = mount(cache, memoryVault(null))

    await waitFor(() => expect(api()).not.toBeNull())
    await api().resyncAll()

    expect(screen.getByText('끊김')).toBeTruthy()
  })
})

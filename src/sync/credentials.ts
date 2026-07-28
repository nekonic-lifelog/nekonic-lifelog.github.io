import type { Envelope } from '../crypto/envelope'

const DB_NAME = 'lifelog-keys'
const DB_VERSION = 1
const CREDS = 'creds'
const CACHE = 'cache'
const CREDS_KEY = 'current'
const CACHE_KEY = 'tree'

export interface RemoteConfig {
  owner: string
  repo: string
  branch: string
}

export interface Credentials {
  dataKey: CryptoKey
  envelope: Envelope
  token: string
  remote: RemoteConfig
}

export interface CredentialStore {
  load(): Promise<Credentials | null>
  save(c: Credentials): Promise<void>
  clear(): Promise<void>
}

export interface SyncCacheData {
  commitSha: string
  blobs: Record<string, string>
  pushed: Record<string, string>
  backfilled: boolean
}

export interface SyncCache {
  load(): Promise<SyncCacheData>
  save(data: SyncCacheData): Promise<void>
  clear(): Promise<void>
}

export function emptyCache(): SyncCacheData {
  return { commitSha: '', blobs: {}, pushed: {}, backfilled: false }
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('트랜잭션이 중단되었습니다'))
  })
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(CREDS)) {
        db.createObjectStore(CREDS, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(CACHE)) {
        db.createObjectStore(CACHE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function readRow<T>(name: string, key: string): Promise<T | undefined> {
  const db = await open()
  try {
    const tx = db.transaction(name, 'readonly')
    const row = await promisify<{ key: string; value: T } | undefined>(
      tx.objectStore(name).get(key),
    )
    await done(tx)
    return row?.value
  } finally {
    db.close()
  }
}

async function writeRow(name: string, key: string, value: unknown): Promise<void> {
  const db = await open()
  try {
    const tx = db.transaction(name, 'readwrite')
    tx.objectStore(name).put({ key, value })
    await done(tx)
  } finally {
    db.close()
  }
}

async function dropRow(name: string, key: string): Promise<void> {
  const db = await open()
  try {
    const tx = db.transaction(name, 'readwrite')
    tx.objectStore(name).delete(key)
    await done(tx)
  } finally {
    db.close()
  }
}

function isRemote(value: unknown): value is RemoteConfig {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return (
    typeof r['owner'] === 'string' &&
    typeof r['repo'] === 'string' &&
    typeof r['branch'] === 'string'
  )
}

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null) return false
  const e = value as Record<string, unknown>
  return typeof e['v'] === 'number' && Array.isArray(e['wraps'])
}

function isKey(value: unknown): value is CryptoKey {
  if (typeof value !== 'object' || value === null) return false
  const k = value as Record<string, unknown>
  return typeof k['algorithm'] === 'object' && Array.isArray(k['usages'])
}

function asCredentials(value: unknown): Credentials | null {
  if (typeof value !== 'object' || value === null) return null
  const c = value as Record<string, unknown>
  if (!isKey(c['dataKey'])) return null
  if (!isEnvelope(c['envelope'])) return null
  if (typeof c['token'] !== 'string' || c['token'] === '') return null
  if (!isRemote(c['remote'])) return null
  return {
    dataKey: c['dataKey'],
    envelope: c['envelope'],
    token: c['token'],
    remote: c['remote'],
  }
}

function asCache(value: unknown): SyncCacheData {
  if (typeof value !== 'object' || value === null) return emptyCache()
  const c = value as Record<string, unknown>
  const blobs = c['blobs']
  const pushed = c['pushed']
  return {
    commitSha: typeof c['commitSha'] === 'string' ? c['commitSha'] : '',
    blobs: typeof blobs === 'object' && blobs !== null ? { ...(blobs as Record<string, string>) } : {},
    pushed:
      typeof pushed === 'object' && pushed !== null
        ? { ...(pushed as Record<string, string>) }
        : {},
    backfilled: c['backfilled'] === true,
  }
}

export function idbCredentials(): CredentialStore {
  return {
    async load() {
      return asCredentials(await readRow<unknown>(CREDS, CREDS_KEY))
    },
    async save(c) {
      await writeRow(CREDS, CREDS_KEY, {
        dataKey: c.dataKey,
        envelope: c.envelope,
        token: c.token,
        remote: { ...c.remote },
      })
    },
    async clear() {
      await dropRow(CREDS, CREDS_KEY)
    },
  }
}

export function idbSyncCache(): SyncCache {
  return {
    async load() {
      return asCache(await readRow<unknown>(CACHE, CACHE_KEY))
    },
    async save(data) {
      await writeRow(CACHE, CACHE_KEY, data)
    },
    async clear() {
      await dropRow(CACHE, CACHE_KEY)
    },
  }
}

export function memorySyncCache(): SyncCache {
  let held = emptyCache()
  return {
    async load() {
      return asCache(held)
    },
    async save(data) {
      held = asCache(data)
    },
    async clear() {
      held = emptyCache()
    },
  }
}

export function memoryCredentials(): CredentialStore {
  let held: Credentials | null = null
  return {
    async load() {
      return held
    },
    async save(c) {
      held = c
    },
    async clear() {
      held = null
    },
  }
}

import { DEFAULT_SETTINGS, type Settings } from '../lib/types'
import { newId } from '../lib/ids'
import type { RowTypes, Snapshot, Store, TableName } from './store'

const DB_NAME = 'lifelog'
const DB_VERSION = 2
const TABLES: TableName[] = [
  'definitions',
  'records',
  'todos',
  'projects',
  'books',
  'journal',
]
const INDEXES: Partial<Record<TableName, string[]>> = {
  records: ['defId'],
  books: ['defId'],
  journal: ['projectId'],
}
const META = 'meta'

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

async function writeAtomically(tx: IDBTransaction, queue: () => void): Promise<void> {
  const settled = done(tx)
  try {
    queue()
  } catch (err) {
    tx.abort()
    await settled.catch(() => undefined)
    throw err
  }
  await settled
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const table of TABLES) {
        if (!db.objectStoreNames.contains(table)) {
          const os = db.createObjectStore(table, { keyPath: 'id' })
          for (const name of INDEXES[table] ?? []) {
            os.createIndex(name, name, { unique: false })
          }
        }
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function readMeta<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  const tx = db.transaction(META, 'readonly')
  const row = await promisify<{ key: string; value: T } | undefined>(
    tx.objectStore(META).get(key),
  )
  return row?.value
}

export class IdbStore implements Store {
  #db: IDBDatabase | null = null
  #deviceId: string | null = null

  async #open(): Promise<IDBDatabase> {
    if (!this.#db) this.#db = await open()
    return this.#db
  }

  close(): void {
    this.#db?.close()
    this.#db = null
  }

  async deviceId(): Promise<string> {
    if (this.#deviceId) return this.#deviceId
    const db = await this.#open()
    const existing = await readMeta<string>(db, 'deviceId')
    if (existing) {
      this.#deviceId = existing
      return existing
    }
    const fresh = newId()
    const tx = db.transaction(META, 'readwrite')
    tx.objectStore(META).put({ key: 'deviceId', value: fresh })
    await done(tx)
    this.#deviceId = fresh
    return fresh
  }

  async adoptDeviceId(id: string): Promise<void> {
    const trimmed = id.trim()
    if (trimmed === '') throw new Error('기기 ID가 비어 있습니다')
    const db = await this.#open()
    const tx = db.transaction(META, 'readwrite')
    tx.objectStore(META).put({ key: 'deviceId', value: trimmed })
    await done(tx)
    this.#deviceId = trimmed
  }

  async loadAll(): Promise<Snapshot> {
    const db = await this.#open()
    const tx = db.transaction([...TABLES, META], 'readonly')
    const [definitions, records, todos, projects, books, journal, settings] =
      await Promise.all([
        promisify(tx.objectStore('definitions').getAll()),
        promisify(tx.objectStore('records').getAll()),
        promisify(tx.objectStore('todos').getAll()),
        promisify(tx.objectStore('projects').getAll()),
        promisify(tx.objectStore('books').getAll()),
        promisify(tx.objectStore('journal').getAll()),
        promisify<{ key: string; value: Settings } | undefined>(
          tx.objectStore(META).get('settings'),
        ),
      ])
    await done(tx)
    return {
      definitions,
      records,
      todos,
      projects,
      books,
      journal,
      settings: { ...DEFAULT_SETTINGS, ...(settings?.value ?? {}) },
    }
  }

  async put<K extends TableName>(table: K, rows: RowTypes[K][]): Promise<void> {
    if (rows.length === 0) return
    const db = await this.#open()
    const tx = db.transaction(table, 'readwrite')
    await writeAtomically(tx, () => {
      const os = tx.objectStore(table)
      for (const row of rows) os.put(row)
    })
  }

  async putSettings(settings: Settings): Promise<void> {
    const db = await this.#open()
    const tx = db.transaction(META, 'readwrite')
    tx.objectStore(META).put({ key: 'settings', value: settings })
    await done(tx)
  }

  async replaceAll(snapshot: Snapshot): Promise<void> {
    const db = await this.#open()
    const tx = db.transaction([...TABLES, META], 'readwrite')
    await writeAtomically(tx, () => {
      for (const table of TABLES) tx.objectStore(table).clear()
      for (const table of TABLES) {
        const os = tx.objectStore(table)
        for (const row of snapshot[table]) os.put(row)
      }
      tx.objectStore(META).put({ key: 'settings', value: snapshot.settings })
    })
  }
}

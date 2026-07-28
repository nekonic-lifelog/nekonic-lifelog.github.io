import { openJson, sealJson } from '../crypto/cipher'
import type { Snapshot, Store, TableName } from '../data/store'
import type { Clock } from '../lib/clock'
import {
  buildReminderFile,
  reminderPathFor,
  sameReminderFile,
  serializeReminderFile,
  type ReminderFile,
} from '../lib/reminders'
import type { Base } from '../lib/types'
import type { GithubRepo } from '../remote/github'
import { AuthError } from '../remote/types'
import type { CommitPlan, PutFile, RemoteHead, TreeEntry } from '../remote/types'
import { idbSyncCache, type SyncCache } from './credentials'
import { mergeSnapshots, ownRows } from './merge'
import { TABLE_ORDER, groupByPath, parsePath, pathFor } from './paths'

export type SyncPhase = 'idle' | 'pulling' | 'pushing' | 'error'

export interface SyncState {
  phase: SyncPhase
  lastSuccessAt: string | null
  pendingCount: number
  authFailed: boolean
  lastError: string | null
  backfilling: boolean
}

export interface SyncEngineOptions {
  store: Store
  repo: GithubRepo
  dataKey: CryptoKey
  deviceId: string
  clock: Clock
  debounceMs?: number
  recentMonths?: number
  cache?: SyncCache
  onState?(s: SyncState): void
  onSnapshot?(s: Snapshot): void
}

type RowBag = Partial<Record<TableName, Base[]>>

const DEFAULT_DEBOUNCE = 4000
const DEFAULT_RECENT_MONTHS = 3
const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/
const COMMIT_MESSAGE = '기록 동기화'

const AUTH_MESSAGE =
  'GitHub 토큰이 더 이상 통하지 않습니다. 설정에서 새 토큰을 넣어 주세요.'

const SAMPLE: Base = {
  id: 'x',
  v: 1,
  createdAt: '2026-01-01T00:00:00+09:00',
  deviceId: 'x',
  updatedAt: '2026-01-01T00:00:00+09:00',
  deleted: false,
}

const DIR_NAMES: readonly string[] = [
  ...new Set(TABLE_ORDER.map((table) => pathFor(table, SAMPLE).split('/')[1] ?? '')),
].filter((name) => name !== '')

export function initialSyncState(): SyncState {
  return {
    phase: 'idle',
    lastSuccessAt: null,
    pendingCount: 0,
    authFailed: false,
    lastError: null,
    backfilling: false,
  }
}

function repoPath(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path
}

function localPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function monthsAgo(at: number, back: number): string {
  const d = new Date(at)
  const shifted = new Date(d.getFullYear(), d.getMonth() - back, 1)
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}`
}

function fingerprint(rows: Base[]): string {
  let h = 0x811c9dc5
  for (const b of new TextEncoder().encode(JSON.stringify(rows))) {
    h ^= b
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${h.toString(16)}-${rows.length}`
}

function byId(a: Base, b: Base): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function changedReminders(before: ReminderFile | null, next: ReminderFile): boolean {
  if (before === null) return next.recurring.length > 0 || next.events.length > 0
  return !sameReminderFile(before, next)
}

function reason(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return '알 수 없는 문제로 동기화하지 못했습니다.'
}

export class SyncEngine {
  #opts: SyncEngineOptions
  #cache: SyncCache
  #debounceMs: number
  #recentMonths: number
  #state: SyncState = initialSyncState()
  #timer: ReturnType<typeof setTimeout> | null = null
  #chain: Promise<void> = Promise.resolve()
  #stopped = false

  constructor(opts: SyncEngineOptions) {
    this.#opts = opts
    this.#cache = opts.cache ?? idbSyncCache()
    this.#debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE
    this.#recentMonths = Math.max(1, opts.recentMonths ?? DEFAULT_RECENT_MONTHS)
  }

  get state(): SyncState {
    return { ...this.#state }
  }

  markDirty(): void {
    this.#patch({ pendingCount: this.#state.pendingCount + 1 })
    if (this.#state.authFailed || this.#stopped) return
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = null
      void this.push()
    }, this.#debounceMs)
  }

  pull(): Promise<void> {
    return this.#enqueue(() => this.#guard('pulling', () => this.#pull(false)))
  }

  push(): Promise<void> {
    return this.#enqueue(() => this.#guard('pushing', () => this.#push()))
  }

  async syncNow(): Promise<void> {
    this.#clearTimer()
    await this.pull()
    await this.push()
  }

  backfill(): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#state.authFailed || this.#stopped) return
      this.#patch({ backfilling: true })
      try {
        await this.#guard('pulling', () => this.#pull(true))
      } finally {
        this.#patch({ backfilling: false })
      }
    })
  }

  stop(): void {
    this.#stopped = true
    this.#clearTimer()
  }

  #clearTimer(): void {
    if (this.#timer === null) return
    clearTimeout(this.#timer)
    this.#timer = null
  }

  #enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.#chain.then(task, task)
    this.#chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  #patch(next: Partial<SyncState>): void {
    this.#state = { ...this.#state, ...next }
    this.#opts.onState?.(this.state)
  }

  async #guard(phase: SyncPhase, work: () => Promise<string | null>): Promise<void> {
    if (this.#state.authFailed || this.#stopped) return
    this.#patch({ phase })
    try {
      const soft = await work()
      this.#patch({
        phase: 'idle',
        lastError: soft,
        lastSuccessAt: new Date(this.#opts.clock.now()).toISOString(),
      })
    } catch (err) {
      if (err instanceof AuthError) {
        this.#clearTimer()
        this.#patch({ phase: 'error', authFailed: true, lastError: AUTH_MESSAGE })
        return
      }
      this.#patch({ phase: 'idle', lastError: reason(err) })
    }
  }

  async #entries(head: RemoteHead): Promise<TreeEntry[]> {
    const out = new Map<string, TreeEntry>()
    const take = (prefix: string, entry: TreeEntry): void => {
      const path = localPath(prefix === '' ? entry.path : `${prefix}/${entry.path}`)
      out.set(path, { ...entry, path })
    }
    for (const entry of head.tree.entries) take('', entry)
    if (!head.tree.truncated || head.commitSha === '') return [...out.values()]

    for (const dir of DIR_NAMES) {
      const sub = await this.#opts.repo.readTree(`${head.commitSha}:${dir}`)
      for (const entry of sub.entries) take(dir, entry)
      if (!sub.truncated) continue
      const months = new Set([
        ...sub.entries
          .map((entry) => entry.path.split('/')[0] ?? '')
          .filter((month) => MONTH_RE.test(month)),
        ...this.#recentKeys(),
      ])
      for (const month of months) {
        const deeper = await this.#opts.repo.readTree(`${head.commitSha}:${dir}/${month}`)
        for (const entry of deeper.entries) take(`${dir}/${month}`, entry)
      }
    }
    return [...out.values()]
  }

  #recentKeys(): string[] {
    const out: string[] = []
    for (let back = 0; back < this.#recentMonths; back++) {
      out.push(monthsAgo(this.#opts.clock.now(), back))
    }
    return out
  }

  #wanted(entries: TreeEntry[], full: boolean): TreeEntry[] {
    const cutoff = monthsAgo(this.#opts.clock.now(), this.#recentMonths - 1)
    return entries.filter((entry) => {
      const parsed = parsePath(entry.path)
      if (parsed === null) return false
      if (full || parsed.month === undefined) return true
      return parsed.month >= cutoff
    })
  }

  async #pull(full: boolean): Promise<string | null> {
    const head = await this.#opts.repo.readHead()
    const entries = await this.#entries(head)
    const cache = await this.#cache.load()
    const wide = full || cache.backfilled
    const blobs = { ...cache.blobs }
    const bag: RowBag = {}
    let read = 0
    let soft: string | null = null

    for (const entry of this.#wanted(entries, wide)) {
      const parsed = parsePath(entry.path)
      if (parsed === null) continue
      if (blobs[entry.path] === entry.sha) continue
      const bytes = await this.#opts.repo.readBlob(entry.sha)
      let rows: Base[]
      try {
        const opened = await openJson<unknown>(this.#opts.dataKey, bytes)
        if (!Array.isArray(opened)) throw new Error('내용이 목록이 아닙니다')
        rows = opened as Base[]
      } catch {
        soft = `${entry.path} 파일을 열지 못해 건너뛰었습니다.`
        continue
      }
      const bucket = bag[parsed.table]
      if (bucket) bucket.push(...rows)
      else bag[parsed.table] = [...rows]
      blobs[entry.path] = entry.sha
      read++
    }

    if (read > 0) {
      const local = await this.#opts.store.loadAll()
      const merged = mergeSnapshots(local, bag as Partial<Snapshot>)
      await this.#opts.store.replaceAll(merged)
      this.#opts.onSnapshot?.(merged)
    }

    await this.#cache.save({
      commitSha: head.commitSha,
      blobs,
      pushed: cache.pushed,
      backfilled: cache.backfilled || full,
      reminders: cache.reminders,
    })
    return soft
  }

  async #push(): Promise<string | null> {
    const claimed = this.#state.pendingCount
    const snapshot = await this.#opts.store.loadAll()
    const bag: RowBag = {}
    for (const table of TABLE_ORDER) {
      bag[table] = ownRows(snapshot[table] as Base[], this.#opts.deviceId)
    }

    const cache = await this.#cache.load()
    const pushed = { ...cache.pushed }
    const put: PutFile[] = []
    for (const [path, group] of groupByPath(bag)) {
      const rows = [...group.rows].sort(byId)
      const mark = fingerprint(rows)
      if (cache.pushed[path] === mark) continue
      put.push({ path: repoPath(path), content: await sealJson(this.#opts.dataKey, rows) })
      pushed[path] = mark
    }

    const reminders = buildReminderFile({
      snapshot,
      settings: snapshot.settings,
      now: this.#opts.clock.now(),
    })
    const sendReminders = changedReminders(cache.reminders, reminders)
    if (sendReminders) {
      put.push({
        path: reminderPathFor(this.#opts.deviceId),
        content: new TextEncoder().encode(serializeReminderFile(reminders)),
      })
    }

    if (put.length === 0) {
      this.#patch({ pendingCount: Math.max(0, this.#state.pendingCount - claimed) })
      return null
    }

    const plan: CommitPlan = { message: COMMIT_MESSAGE, put }
    await this.#opts.repo.commitWithRetry(async () => plan)

    await this.#cache.save({
      commitSha: cache.commitSha,
      blobs: cache.blobs,
      pushed,
      backfilled: cache.backfilled,
      reminders: sendReminders ? reminders : cache.reminders,
    })
    this.#patch({ pendingCount: Math.max(0, this.#state.pendingCount - claimed) })
    return null
  }
}

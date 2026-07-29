import { openJson, sealJson } from '../crypto/cipher'
import type { RowTypes, Snapshot, Store, TableName } from '../data/store'
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
import { mergeSnapshots, ownRows, type Clash } from './merge'
import { TABLE_ORDER, groupByPath, parsePath, pathFor } from './paths'

export type SyncPhase = 'idle' | 'pulling' | 'pushing' | 'error'
export type SyncDirection = 'pull' | 'push'
export type SyncOutcome = 'ok' | 'partial' | 'failed'

export interface SyncEvent {
  at: string
  direction: SyncDirection
  outcome: SyncOutcome
  read: number
  wrote: number
  skipped: number
  error: string | null
}

export interface BackfillProgress {
  done: number
  total: number
}

export interface SyncState {
  phase: SyncPhase
  lastSuccessAt: string | null
  lastAttemptAt: string | null
  pendingCount: number
  authFailed: boolean
  lastError: string | null
  skipped: string[]
  clashes: Clash[]
  history: SyncEvent[]
  backfilling: BackfillProgress | null
}

interface Report {
  read: number
  wrote: number
  skipped: string[]
  clashes: Clash[]
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
export const HISTORY_LIMIT = 20
export const CLASH_LIMIT = 20
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
    lastAttemptAt: null,
    pendingCount: 0,
    authFailed: false,
    lastError: null,
    skipped: [],
    clashes: [],
    history: [],
    backfilling: null,
  }
}

export function skippedMessage(paths: string[]): string {
  if (paths.length === 0) return ''
  if (paths.length === 1) return `${paths[0]} 파일을 열지 못해 건너뛰었습니다.`
  const head = paths.slice(0, 3).join(', ')
  const rest = paths.length - 3
  const tail = rest > 0 ? ` 외 ${rest}개` : ''
  return `파일 ${paths.length}개를 열지 못해 건너뛰었습니다: ${head}${tail}`
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
    return this.#enqueue(() => this.#guard('pulling', 'pull', () => this.#pull(false, false)))
  }

  push(): Promise<void> {
    return this.#enqueue(() => this.#guard('pushing', 'push', () => this.#push()))
  }

  async syncNow(): Promise<void> {
    this.#clearTimer()
    await this.pull()
    await this.push()
  }

  backfill(): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#state.authFailed || this.#stopped) return
      this.#patch({ backfilling: { done: 0, total: 0 } })
      try {
        await this.#guard('pulling', 'pull', () => this.#pull(true, true))
      } finally {
        this.#patch({ backfilling: null })
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

  #stamp(): string {
    return new Date(this.#opts.clock.now()).toISOString()
  }

  #logged(event: SyncEvent): SyncEvent[] {
    return [event, ...this.#state.history].slice(0, HISTORY_LIMIT)
  }

  #kept(found: Clash[]): Clash[] {
    if (found.length === 0) return this.#state.clashes
    return [...found, ...this.#state.clashes].slice(0, CLASH_LIMIT)
  }

  async #guard(
    phase: SyncPhase,
    direction: SyncDirection,
    work: () => Promise<Report>,
  ): Promise<void> {
    if (this.#state.authFailed || this.#stopped) return
    this.#patch({ phase })
    try {
      const report = await work()
      const at = this.#stamp()
      const partial = report.skipped.length > 0
      const message = partial ? skippedMessage(report.skipped) : null
      this.#patch({
        phase: 'idle',
        lastError: message,
        skipped: report.skipped,
        clashes: this.#kept(report.clashes),
        lastAttemptAt: at,
        lastSuccessAt: partial ? this.#state.lastSuccessAt : at,
        history: this.#logged({
          at,
          direction,
          outcome: partial ? 'partial' : 'ok',
          read: report.read,
          wrote: report.wrote,
          skipped: report.skipped.length,
          error: message,
        }),
      })
    } catch (err) {
      const at = this.#stamp()
      const blocked = err instanceof AuthError
      const message = blocked ? AUTH_MESSAGE : reason(err)
      if (blocked) this.#clearTimer()
      this.#patch({
        phase: blocked ? 'error' : 'idle',
        authFailed: blocked,
        lastError: message,
        lastAttemptAt: at,
        history: this.#logged({
          at,
          direction,
          outcome: 'failed',
          read: 0,
          wrote: 0,
          skipped: 0,
          error: message,
        }),
      })
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

  async #pull(full: boolean, watch: boolean): Promise<Report> {
    const head = await this.#opts.repo.readHead()
    const entries = await this.#entries(head)
    const cache = await this.#cache.load()
    const wide = full || cache.backfilled
    const blobs = { ...cache.blobs }
    const bag: RowBag = {}
    const skipped: string[] = []
    const clashes: Clash[] = []
    let read = 0

    const todo = this.#wanted(entries, wide).filter(
      (entry) => parsePath(entry.path) !== null && blobs[entry.path] !== entry.sha,
    )
    const total = todo.length
    if (watch) this.#patch({ backfilling: { done: 0, total } })

    let done = 0
    for (const entry of todo) {
      const parsed = parsePath(entry.path)
      if (parsed === null) continue
      const bytes = await this.#opts.repo.readBlob(entry.sha)
      let rows: Base[] | null = null
      try {
        const opened = await openJson<unknown>(this.#opts.dataKey, bytes)
        if (!Array.isArray(opened)) throw new Error('내용이 목록이 아닙니다')
        rows = opened as Base[]
      } catch {
        skipped.push(entry.path)
      }
      if (rows !== null) {
        const bucket = bag[parsed.table]
        if (bucket) bucket.push(...rows)
        else bag[parsed.table] = [...rows]
        blobs[entry.path] = entry.sha
        read++
      }
      done++
      if (watch) this.#patch({ backfilling: { done, total } })
    }

    if (read > 0) {
      const local = await this.#opts.store.loadAll()
      const merged = mergeSnapshots(local, bag as Partial<Snapshot>, (clash) => clashes.push(clash))
      const wrote = await this.#absorb(local, merged)
      this.#opts.onSnapshot?.(wrote ? await this.#opts.store.loadAll() : merged)
    }

    await this.#cache.save({
      commitSha: head.commitSha,
      blobs,
      pushed: cache.pushed,
      backfilled: cache.backfilled || full,
      reminders: cache.reminders,
    })
    return { read, wrote: 0, skipped, clashes }
  }

  async #absorb(local: Snapshot, merged: Snapshot): Promise<boolean> {
    let wrote = false
    for (const table of TABLE_ORDER) {
      const before = new Map((local[table] as Base[]).map((row) => [row.id, row]))
      const rows = (merged[table] as Base[]).filter((row) => before.get(row.id) !== row)
      if (rows.length === 0) continue
      await this.#opts.store.put(table, rows as RowTypes[TableName][])
      wrote = true
    }
    return wrote
  }

  async #push(): Promise<Report> {
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
      return { read: 0, wrote: 0, skipped: [], clashes: [] }
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
    return { read: 0, wrote: put.length, skipped: [], clashes: [] }
  }
}

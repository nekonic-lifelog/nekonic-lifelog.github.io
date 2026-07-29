import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Clock } from '../lib/clock'
import { todayKey, type DayKey } from '../lib/day'
import type { Settings } from '../lib/types'
import type { WriteCtx } from '../data/mutations'
import type { DraftStore, RowTypes, Snapshot, Store, TableName } from '../data/store'
import { notifyDirty } from './dirty'
import { DraftCtx, draftStoreOf } from './drafts'
import { DEFAULT_SETTINGS } from '../lib/types'

const EMPTY: Snapshot = {
  definitions: [],
  records: [],
  todos: [],
  projects: [],
  books: [],
  journal: [],
  settings: DEFAULT_SETTINGS,
}

export interface AppApi {
  ready: boolean
  snapshot: Snapshot
  deviceId: string
  clock: Clock
  today: DayKey
  boundaryHour: number
  ctx: WriteCtx

  write<K extends TableName>(table: K, rows: RowTypes[K][]): Promise<void>
  saveSettings(patch: Partial<Settings>): Promise<void>
  replaceAll(snapshot: Snapshot): Promise<void>
  adoptDeviceId(id: string): Promise<void>
}

const Ctx = createContext<AppApi | null>(null)

export function useApp(): AppApi {
  const api = useContext(Ctx)
  if (!api) throw new Error('AppProvider 밖에서 useApp을 불렀습니다')
  return api
}

export function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return existing
  const byId = new Map(existing.map((row) => [row.id, row]))
  for (const row of incoming) byId.set(row.id, row)
  return [...byId.values()]
}

export function AppProvider({
  store,
  clock,
  children,
}: {
  store: Store & Partial<DraftStore>
  clock: Clock
  children: ReactNode
}) {
  const drafts = useMemo(() => draftStoreOf(store), [store])
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY)
  const [deviceId, setDeviceId] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const id = await store.deviceId()
      const loaded = await store.loadAll()
      if (!alive) return
      setDeviceId(id)
      setSnapshot(loaded)
      setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [store])

  const ctx: WriteCtx = useMemo(() => ({ deviceId, clock }), [deviceId, clock])

  const write = useCallback(
    async <K extends TableName>(table: K, rows: RowTypes[K][]) => {
      if (rows.length === 0) return
      setSnapshot((s) => ({ ...s, [table]: mergeById(s[table] as RowTypes[K][], rows) }))
      await store.put(table, rows)
      notifyDirty()
    },
    [store],
  )

  const api = useMemo<AppApi>(() => {
    const boundaryHour = snapshot.settings.dayBoundaryHour
    return {
      ready,
      snapshot,
      deviceId,
      clock,
      today: todayKey(clock, boundaryHour),
      boundaryHour,
      ctx,
      write,

      async saveSettings(patch) {
        const next = { ...snapshot.settings, ...patch }
        setSnapshot((s) => ({ ...s, settings: next }))
        await store.putSettings(next)
        notifyDirty()
      },

      async replaceAll(next) {
        await store.replaceAll(next)
        setSnapshot(next)
        notifyDirty()
      },

      async adoptDeviceId(id) {
        await store.adoptDeviceId(id)
        setDeviceId(id.trim())
      },
    }
  }, [snapshot, ready, deviceId, clock, ctx, store, write])

  return (
    <Ctx.Provider value={api}>
      <DraftCtx.Provider value={drafts}>{children}</DraftCtx.Provider>
    </Ctx.Provider>
  )
}

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
import { dayKeyToDate, logicalDay, todayKey, type DayKey } from '../lib/day'
import type {
  Definition,
  DefinitionKind,
  LogRecord,
  Settings,
  Todo,
  TodoStatus,
} from '../lib/types'
import { withNewTarget } from '../lib/streak'
import { createBase, softDelete, touch, type WriteCtx } from '../data/mutations'
import type { Snapshot, Store } from '../data/store'
import { DEFAULT_SETTINGS } from '../lib/types'

const EMPTY: Snapshot = {
  definitions: [],
  records: [],
  todos: [],
  settings: DEFAULT_SETTINGS,
}

export interface NewDefinition {
  name: string
  kind: DefinitionKind
  unit?: string | undefined
  target?: number | undefined
  targetDays?: number[] | undefined
}

export interface NewTodo {
  title: string
  dueAt?: string | undefined
  pinned?: boolean | undefined
  note?: string | undefined
}

export interface AppApi {
  ready: boolean
  snapshot: Snapshot
  deviceId: string
  clock: Clock
  today: DayKey

  addDefinition(input: NewDefinition): Promise<void>
  editDefinition(
    def: Definition,
    patch: Partial<Pick<Definition, 'name' | 'unit' | 'targetDays' | 'archived' | 'order'>>,
  ): Promise<void>
  setTarget(def: Definition, target: number): Promise<void>
  removeDefinition(def: Definition): Promise<void>

  toggleCheck(def: Definition, day: DayKey): Promise<void>
  addQuantity(def: Definition, day: DayKey, value: number): Promise<void>
  undoLast(def: Definition, day: DayKey): Promise<void>

  addTodo(input: NewTodo): Promise<void>
  editTodo(todo: Todo, patch: Partial<Todo>): Promise<void>
  setTodoStatus(todo: Todo, status: TodoStatus): Promise<void>
  removeTodo(todo: Todo): Promise<void>

  saveSettings(patch: Partial<Settings>): Promise<void>
  replaceAll(snapshot: Snapshot): Promise<void>
}

const Ctx = createContext<AppApi | null>(null)

export function useApp(): AppApi {
  const api = useContext(Ctx)
  if (!api) throw new Error('AppProvider 밖에서 useApp을 불렀습니다')
  return api
}

function atForDay(day: DayKey, clock: Clock, boundaryHour: number): string {
  if (logicalDay(clock.now(), boundaryHour) === day) {
    return new Date(clock.now()).toISOString()
  }
  const noon = dayKeyToDate(day)
  noon.setHours(12, 0, 0, 0)
  return noon.toISOString()
}

export function AppProvider({
  store,
  clock,
  children,
}: {
  store: Store
  clock: Clock
  children: ReactNode
}) {
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

  const writeDefs = useCallback(
    async (rows: Definition[]) => {
      setSnapshot((s) => ({ ...s, definitions: mergeById(s.definitions, rows) }))
      await store.put('definitions', rows)
    },
    [store],
  )

  const writeRecords = useCallback(
    async (rows: LogRecord[]) => {
      if (rows.length === 0) return
      setSnapshot((s) => ({ ...s, records: mergeById(s.records, rows) }))
      await store.put('records', rows)
    },
    [store],
  )

  const writeTodos = useCallback(
    async (rows: Todo[]) => {
      setSnapshot((s) => ({ ...s, todos: mergeById(s.todos, rows) }))
      await store.put('todos', rows)
    },
    [store],
  )

  const api = useMemo<AppApi>(() => {
    const boundaryHour = snapshot.settings.dayBoundaryHour

    const recordsOn = (def: Definition, day: DayKey) =>
      snapshot.records.filter(
        (r) => !r.deleted && r.defId === def.id && logicalDay(r.at, boundaryHour) === day,
      )

    return {
      ready,
      snapshot,
      deviceId,
      clock,
      today: todayKey(clock, boundaryHour),

      async addDefinition(input) {
        const maxOrder = snapshot.definitions.reduce(
          (max, d) => (d.deleted ? max : Math.max(max, d.order)),
          -1,
        )
        const base = createBase(ctx)
        const def: Definition = {
          ...base,
          kind: input.kind,
          name: input.name.trim(),
          unit: input.unit?.trim() || undefined,
          targetDays: input.targetDays?.length ? input.targetDays : undefined,
          targetHistory:
            input.kind === 'quantity' && input.target !== undefined
              ? [{ from: base.createdAt, target: input.target }]
              : [],
          order: maxOrder + 1,
          hidden: false,
          archived: false,
        }
        await writeDefs([def])
      },

      async editDefinition(def, patch) {
        await writeDefs([touch({ ...def, ...patch }, ctx)])
      },

      async setTarget(def, target) {
        const now = new Date(clock.now()).toISOString()
        const targetHistory = withNewTarget(def.targetHistory, target, now, boundaryHour)
        await writeDefs([touch({ ...def, targetHistory }, ctx)])
      },

      async removeDefinition(def) {
        const orphans = snapshot.records
          .filter((r) => r.defId === def.id && !r.deleted)
          .map((r) => softDelete(r, ctx))
        await writeDefs([softDelete(def, ctx)])
        await writeRecords(orphans)
      },

      async toggleCheck(def, day) {
        const existing = recordsOn(def, day)
        if (existing.length > 0) {
          await writeRecords(existing.map((r) => softDelete(r, ctx)))
          return
        }
        await writeRecords([
          { ...createBase(ctx), defId: def.id, at: atForDay(day, clock, boundaryHour), value: 1 },
        ])
      },

      async addQuantity(def, day, value) {
        if (!Number.isFinite(value) || value === 0) return
        await writeRecords([
          {
            ...createBase(ctx),
            defId: def.id,
            at: atForDay(day, clock, boundaryHour),
            value,
          },
        ])
      },

      async undoLast(def, day) {
        const newest = recordsOn(def, day).reduce<LogRecord | null>((best, r) => {
          if (best === null) return r
          if (r.createdAt !== best.createdAt) return r.createdAt > best.createdAt ? r : best
          return r.id > best.id ? r : best
        }, null)
        if (newest) await writeRecords([softDelete(newest, ctx)])
      },

      async addTodo(input) {
        const todo: Todo = {
          ...createBase(ctx),
          title: input.title.trim(),
          status: 'todo',
          dueAt: input.dueAt,
          pinned: input.pinned ?? false,
          note: input.note,
        }
        await writeTodos([todo])
      },

      async editTodo(todo, patch) {
        await writeTodos([touch({ ...todo, ...patch }, ctx)])
      },

      async setTodoStatus(todo, status) {
        const doneAt = status === 'done' ? new Date(clock.now()).toISOString() : undefined
        await writeTodos([touch({ ...todo, status, doneAt }, ctx)])
      },

      async removeTodo(todo) {
        await writeTodos([softDelete(todo, ctx)])
      },

      async saveSettings(patch) {
        const next = { ...snapshot.settings, ...patch }
        setSnapshot((s) => ({ ...s, settings: next }))
        await store.putSettings(next)
      },

      async replaceAll(next) {
        await store.replaceAll(next)
        setSnapshot(next)
      },
    }
  }, [snapshot, ready, deviceId, clock, ctx, store, writeDefs, writeRecords, writeTodos])

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return existing
  const byId = new Map(existing.map((row) => [row.id, row]))
  for (const row of incoming) byId.set(row.id, row)
  return [...byId.values()]
}

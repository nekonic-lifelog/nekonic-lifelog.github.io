import { useMemo } from 'react'
import type { Clock } from '../lib/clock'
import { dayKeyToDate, logicalDay, type DayKey } from '../lib/day'
import { withNewTarget } from '../lib/streak'
import type { Definition, DefinitionKind, LogRecord } from '../lib/types'
import { createBase, softDelete, touch } from '../data/mutations'
import { useApp } from './app'

export interface NewDefinition {
  name: string
  kind: DefinitionKind
  unit?: string | undefined
  target?: number | undefined
  targetDays?: number[] | undefined
}

export type DefinitionPatch = Partial<
  Pick<Definition, 'name' | 'unit' | 'targetDays' | 'archived' | 'order'>
>

export interface HabitsApi {
  addDefinition(input: NewDefinition): Promise<void>
  editDefinition(def: Definition, patch: DefinitionPatch): Promise<void>
  setTarget(def: Definition, target: number): Promise<void>
  removeDefinition(def: Definition): Promise<void>

  toggleCheck(def: Definition, day: DayKey): Promise<void>
  addQuantity(def: Definition, day: DayKey, value: number): Promise<void>
  undoLast(def: Definition, day: DayKey): Promise<void>
}

export function atForDay(day: DayKey, clock: Clock, boundaryHour: number): string {
  if (logicalDay(clock.now(), boundaryHour) === day) {
    return new Date(clock.now()).toISOString()
  }
  const noon = dayKeyToDate(day)
  noon.setHours(12, 0, 0, 0)
  return noon.toISOString()
}

export function useHabits(): HabitsApi {
  const app = useApp()
  const { snapshot, clock, ctx, write, boundaryHour } = app

  return useMemo<HabitsApi>(() => {
    const recordsOn = (def: Definition, day: DayKey) =>
      snapshot.records.filter(
        (r) => !r.deleted && r.defId === def.id && logicalDay(r.at, boundaryHour) === day,
      )

    return {
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
        await write('definitions', [def])
      },

      async editDefinition(def, patch) {
        await write('definitions', [touch({ ...def, ...patch }, ctx)])
      },

      async setTarget(def, target) {
        const now = new Date(clock.now()).toISOString()
        const targetHistory = withNewTarget(def.targetHistory, target, now, boundaryHour)
        await write('definitions', [touch({ ...def, targetHistory }, ctx)])
      },

      async removeDefinition(def) {
        const orphans = snapshot.records
          .filter((r) => r.defId === def.id && !r.deleted)
          .map((r) => softDelete(r, ctx))
        await write('definitions', [softDelete(def, ctx)])
        await write('records', orphans)
      },

      async toggleCheck(def, day) {
        const existing = recordsOn(def, day)
        if (existing.length > 0) {
          await write(
            'records',
            existing.map((r) => softDelete(r, ctx)),
          )
          return
        }
        await write('records', [
          { ...createBase(ctx), defId: def.id, at: atForDay(day, clock, boundaryHour), value: 1 },
        ])
      },

      async addQuantity(def, day, value) {
        if (!Number.isFinite(value) || value === 0) return
        await write('records', [
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
        if (newest) await write('records', [softDelete(newest, ctx)])
      },
    }
  }, [snapshot, clock, ctx, write, boundaryHour])
}

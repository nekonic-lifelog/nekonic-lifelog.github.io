import type { Clock } from '../lib/clock'
import { newId } from '../lib/ids'
import { SCHEMA_VERSION, type Base } from '../lib/types'

export interface WriteCtx {
  deviceId: string
  clock: Clock
}

export function createBase(ctx: WriteCtx): Base {
  const now = new Date(ctx.clock.now()).toISOString()
  return {
    id: newId(),
    v: SCHEMA_VERSION,
    createdAt: now,
    deviceId: ctx.deviceId,
    updatedAt: now,
    deleted: false,
  }
}

export function touch<T extends Base>(row: T, ctx: WriteCtx): T {
  return {
    ...row,
    v: SCHEMA_VERSION,
    deviceId: ctx.deviceId,
    updatedAt: new Date(ctx.clock.now()).toISOString(),
  }
}

export function softDelete<T extends Base>(row: T, ctx: WriteCtx): T {
  return { ...touch(row, ctx), deleted: true }
}

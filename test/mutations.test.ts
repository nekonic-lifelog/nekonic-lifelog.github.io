import { describe, expect, it } from 'vitest'
import { fixedClock, mutableClock } from '../src/lib/clock'
import { createBase, softDelete, touch, type WriteCtx } from '../src/data/mutations'
import { SCHEMA_VERSION } from '../src/lib/types'

const DEVICE = 'device-a'

function ctxAt(at: string): WriteCtx {
  return { deviceId: DEVICE, clock: fixedClock(at) }
}

describe('createBase', () => {
  it('createdAt과 updatedAt을 같은 시각으로 채운다', () => {
    const base = createBase(ctxAt('2026-03-01T12:00:00Z'))
    expect(base.createdAt).toBe('2026-03-01T12:00:00.000Z')
    expect(base.updatedAt).toBe(base.createdAt)
  })

  it('deviceId와 스키마 버전을 채우고 deleted는 거짓이다', () => {
    const base = createBase(ctxAt('2026-03-01T12:00:00Z'))
    expect(base.deviceId).toBe(DEVICE)
    expect(base.v).toBe(SCHEMA_VERSION)
    expect(base.deleted).toBe(false)
  })

  it('부를 때마다 다른 id를 준다', () => {
    const ctx = ctxAt('2026-03-01T12:00:00Z')
    expect(createBase(ctx).id).not.toBe(createBase(ctx).id)
  })
})

describe('touch', () => {
  it('createdAt과 id는 그대로 두고 updatedAt만 올린다', () => {
    const base = createBase(ctxAt('2026-03-01T12:00:00Z'))
    const next = touch(base, ctxAt('2026-03-02T09:00:00Z'))
    expect(next.id).toBe(base.id)
    expect(next.createdAt).toBe(base.createdAt)
    expect(next.updatedAt).toBe('2026-03-02T09:00:00.000Z')
  })

  it('마지막으로 수정한 기기로 deviceId를 바꾼다', () => {
    const base = createBase(ctxAt('2026-03-01T12:00:00Z'))
    const next = touch(base, { deviceId: 'device-b', clock: fixedClock('2026-03-02T09:00:00Z') })
    expect(next.deviceId).toBe('device-b')
    expect(next.createdAt).toBe(base.createdAt)
  })

  it('같은 시각에 다시 부르면 updatedAt이 그대로다', () => {
    const ctx = ctxAt('2026-03-01T12:00:00Z')
    const base = createBase(ctx)
    expect(touch(base, ctx).updatedAt).toBe(base.updatedAt)
  })

  it('시계가 뒤로 가도 updatedAt이 되돌아가지 않는다', () => {
    const base = createBase(ctxAt('2026-03-02T09:00:00Z'))
    const next = touch(base, ctxAt('2026-03-01T12:00:00Z'))
    expect(next.updatedAt).toBe(base.updatedAt)
  })

  it('시계가 뒤로 갔다가 앞서면 그 시각을 따른다', () => {
    const clock = mutableClock('2026-03-02T09:00:00Z')
    const ctx: WriteCtx = { deviceId: DEVICE, clock }
    const base = createBase(ctx)

    clock.set('2026-03-01T12:00:00Z')
    const back = touch(base, ctx)
    expect(back.updatedAt).toBe('2026-03-02T09:00:00.000Z')

    clock.set('2026-03-03T00:00:00Z')
    expect(touch(back, ctx).updatedAt).toBe('2026-03-03T00:00:00.000Z')
  })

  it('시계가 뒤로 간 채로 여러 번 고쳐도 updatedAt이 단조롭다', () => {
    const clock = mutableClock('2026-03-05T00:00:00Z')
    const ctx: WriteCtx = { deviceId: DEVICE, clock }
    let row = createBase(ctx)

    for (const at of ['2026-03-04T00:00:00Z', '2026-03-01T00:00:00Z', '2026-02-01T00:00:00Z']) {
      const previous = row.updatedAt
      clock.set(at)
      row = touch(row, ctx)
      expect(Date.parse(row.updatedAt)).toBeGreaterThanOrEqual(Date.parse(previous))
    }
    expect(row.updatedAt).toBe('2026-03-05T00:00:00.000Z')
  })

  it('updatedAt이 읽을 수 없는 값이면 현재 시각으로 덮는다', () => {
    const base = { ...createBase(ctxAt('2026-03-01T12:00:00Z')), updatedAt: '알 수 없음' }
    expect(touch(base, ctxAt('2026-03-02T09:00:00Z')).updatedAt).toBe('2026-03-02T09:00:00.000Z')
  })
})

describe('softDelete', () => {
  it('deleted를 세우고 updatedAt을 올린다', () => {
    const base = createBase(ctxAt('2026-03-01T12:00:00Z'))
    const gone = softDelete(base, ctxAt('2026-03-02T09:00:00Z'))
    expect(gone.deleted).toBe(true)
    expect(gone.updatedAt).toBe('2026-03-02T09:00:00.000Z')
    expect(gone.id).toBe(base.id)
    expect(gone.createdAt).toBe(base.createdAt)
  })

  it('시계가 뒤로 가도 삭제가 되돌아가지 않는다', () => {
    const base = createBase(ctxAt('2026-03-02T09:00:00Z'))
    const gone = softDelete(base, ctxAt('2026-03-01T12:00:00Z'))
    expect(gone.deleted).toBe(true)
    expect(Date.parse(gone.updatedAt)).toBeGreaterThanOrEqual(Date.parse(base.updatedAt))
  })
})

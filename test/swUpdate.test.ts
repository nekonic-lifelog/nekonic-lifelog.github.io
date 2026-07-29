import { describe, expect, it } from 'vitest'
import { mutableClock } from '../src/lib/clock'
import { UPDATE_CHECK_MS, makeUpdateGate } from '../src/lib/sw'

const NOW = '2026-07-30T09:00:00+09:00'
const START = new Date(NOW).getTime()

describe('갱신 확인 — 돌아올 때마다 두드리지 않는다', () => {
  it('처음 돌아왔을 때는 확인한다', () => {
    const gate = makeUpdateGate(mutableClock(NOW))

    expect(gate.due()).toBe(true)
  })

  it('막 확인했으면 다시 확인하지 않는다', () => {
    const gate = makeUpdateGate(mutableClock(NOW))

    expect(gate.due()).toBe(true)
    expect(gate.due()).toBe(false)
  })

  it('간격이 지나면 다시 확인한다', () => {
    const clock = mutableClock(NOW)
    const gate = makeUpdateGate(clock)

    expect(gate.due()).toBe(true)
    clock.set(START + UPDATE_CHECK_MS)
    expect(gate.due()).toBe(true)
  })

  it('간격 직전에는 확인하지 않는다', () => {
    const clock = mutableClock(NOW)
    const gate = makeUpdateGate(clock)

    gate.due()
    clock.set(START + UPDATE_CHECK_MS - 1)
    expect(gate.due()).toBe(false)
  })

  it('간격은 하루보다 짧고 1분보다 길다', () => {
    expect(UPDATE_CHECK_MS).toBeLessThan(24 * 60 * 60 * 1000)
    expect(UPDATE_CHECK_MS).toBeGreaterThan(60 * 1000)
  })

  it('여러 번 돌아와도 간격 안에서는 한 번만 확인한다', () => {
    const clock = mutableClock(NOW)
    const gate = makeUpdateGate(clock)
    let checks = 0

    for (let i = 0; i < 10; i++) {
      if (gate.due()) checks += 1
      clock.set(START + i * 1000)
    }

    expect(checks).toBe(1)
  })

  it('오래 켜 두면 간격마다 다시 확인한다', () => {
    const clock = mutableClock(NOW)
    const gate = makeUpdateGate(clock)
    let checks = 0

    for (let i = 0; i < 5; i++) {
      clock.set(START + i * UPDATE_CHECK_MS)
      if (gate.due()) checks += 1
    }

    expect(checks).toBe(5)
  })
})

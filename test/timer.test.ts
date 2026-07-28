import { describe, expect, it } from 'vitest'
import { fixedClock, mutableClock } from '../src/lib/clock'
import {
  formatRemaining,
  idleTimer,
  pause,
  reset,
  resume,
  setDuration,
  start,
  tick,
} from '../src/lib/timer'

const NOW = '2026-03-12T20:00:00+09:00'
const MIN = 60_000

function ticker(at: string = NOW) {
  const clock = mutableClock(at)
  return {
    now: () => clock.now(),
    advance(ms: number) {
      clock.set(clock.now() + ms)
    },
  }
}

describe('타이머 — 설정과 초기 상태', () => {
  it('설정한 시간만큼 남은 채로 대기한다', () => {
    const t = idleTimer(5 * MIN)
    expect(t.phase).toBe('idle')
    expect(t.durationMs).toBe(5 * MIN)
    expect(t.remainingMs).toBe(5 * MIN)
  })

  it('음수나 숫자가 아닌 길이는 0으로 눕힌다', () => {
    expect(idleTimer(-1).durationMs).toBe(0)
    expect(idleTimer(Number.NaN).remainingMs).toBe(0)
  })

  it('길이를 바꾸면 그 길이로 다시 대기한다', () => {
    const t = setDuration(idleTimer(5 * MIN), 90_000)
    expect(t.phase).toBe('idle')
    expect(t.durationMs).toBe(90_000)
    expect(t.remainingMs).toBe(90_000)
  })

  it('길이가 0이면 시작해도 움직이지 않는다', () => {
    const t = idleTimer(0)
    expect(start(t, 0).phase).toBe('idle')
  })
})

describe('타이머 — 흐르고 멈추기', () => {
  it('시작하면 진행 중이 되고 남은 시간이 줄어든다', () => {
    const clock = ticker()
    let t = start(idleTimer(3 * MIN), clock.now())
    expect(t.phase).toBe('running')

    clock.advance(30_000)
    t = tick(t, clock.now())
    expect(t.remainingMs).toBe(150_000)
    expect(t.phase).toBe('running')
  })

  it('여러 번 tick 해도 실제 흐른 시간만큼만 줄어든다', () => {
    const clock = ticker()
    let t = start(idleTimer(MIN), clock.now())
    for (let i = 0; i < 4; i += 1) {
      clock.advance(1000)
      t = tick(t, clock.now())
    }
    expect(t.remainingMs).toBe(56_000)
  })

  it('시계가 그대로면 남은 시간도 그대로다', () => {
    const clock = fixedClock(NOW)
    let t = start(idleTimer(MIN), clock.now())
    t = tick(t, clock.now())
    t = tick(t, clock.now())
    expect(t.remainingMs).toBe(MIN)
  })

  it('대기 중에는 tick이 아무것도 하지 않는다', () => {
    const clock = ticker()
    const t = idleTimer(MIN)
    clock.advance(10 * MIN)
    expect(tick(t, clock.now())).toBe(t)
  })

  it('0에 정확히 닿으면 끝난 상태가 된다', () => {
    const clock = ticker()
    let t = start(idleTimer(MIN), clock.now())
    clock.advance(MIN)
    t = tick(t, clock.now())
    expect(t.phase).toBe('done')
    expect(t.remainingMs).toBe(0)
  })

  it('남은 시간이 0 아래로 내려가지 않는다', () => {
    const clock = ticker()
    let t = start(idleTimer(MIN), clock.now())
    clock.advance(MIN + 5000)
    t = tick(t, clock.now())
    expect(t.remainingMs).toBe(0)
  })

  it('한참 뒤에 돌아와도 정확히 0에서 멈춘다', () => {
    const clock = ticker()
    let t = start(idleTimer(5 * MIN), clock.now())
    clock.advance(6 * 60 * 60 * 1000)
    t = tick(t, clock.now())
    expect(t.phase).toBe('done')
    expect(t.remainingMs).toBe(0)
  })

  it('끝난 뒤에는 tick을 더 불러도 상태가 그대로다', () => {
    const clock = ticker()
    let t = start(idleTimer(MIN), clock.now())
    clock.advance(MIN)
    t = tick(t, clock.now())

    clock.advance(MIN)
    const again = tick(t, clock.now())
    expect(again).toBe(t)
    clock.advance(10 * MIN)
    expect(tick(again, clock.now())).toBe(t)
  })

  it('끝나는 전이는 한 번만 관측된다', () => {
    const clock = ticker()
    let t = start(idleTimer(2000), clock.now())
    let transitions = 0
    for (let i = 0; i < 20; i += 1) {
      clock.advance(500)
      const next = tick(t, clock.now())
      if (t.phase !== 'done' && next.phase === 'done') transitions += 1
      t = next
    }
    expect(transitions).toBe(1)
  })
})

describe('타이머 — 일시정지와 재개', () => {
  it('일시정지하면 그 시점의 남은 시간이 고정된다', () => {
    const clock = ticker()
    let t = start(idleTimer(3 * MIN), clock.now())
    clock.advance(60_000)
    t = pause(t, clock.now())
    expect(t.phase).toBe('paused')
    expect(t.remainingMs).toBe(2 * MIN)
  })

  it('일시정지 중에는 tick을 불러도 시간이 흐르지 않는다', () => {
    const clock = ticker()
    let t = start(idleTimer(3 * MIN), clock.now())
    clock.advance(60_000)
    t = pause(t, clock.now())

    clock.advance(2 * 60 * 60 * 1000)
    t = tick(t, clock.now())
    expect(t.phase).toBe('paused')
    expect(t.remainingMs).toBe(2 * MIN)
  })

  it('한참 뒤에 재개해도 남은 시간이 그대로다', () => {
    const clock = ticker()
    let t = start(idleTimer(10 * MIN), clock.now())
    clock.advance(4 * MIN)
    t = pause(t, clock.now())

    clock.advance(3 * 24 * 60 * 60 * 1000)
    t = resume(t, clock.now())
    expect(t.phase).toBe('running')
    expect(t.remainingMs).toBe(6 * MIN)

    t = tick(t, clock.now())
    expect(t.remainingMs).toBe(6 * MIN)
  })

  it('재개한 뒤 남은 시간만큼 더 흐르면 끝난다', () => {
    const clock = ticker()
    let t = start(idleTimer(10 * MIN), clock.now())
    clock.advance(4 * MIN)
    t = pause(t, clock.now())
    clock.advance(30 * MIN)
    t = resume(t, clock.now())

    clock.advance(6 * MIN - 1)
    t = tick(t, clock.now())
    expect(t.phase).toBe('running')

    clock.advance(1)
    t = tick(t, clock.now())
    expect(t.phase).toBe('done')
  })

  it('일시정지·재개를 반복해도 총 진행 시간은 흐른 만큼만이다', () => {
    const clock = ticker()
    let t = start(idleTimer(10 * MIN), clock.now())
    for (let i = 0; i < 3; i += 1) {
      clock.advance(MIN)
      t = pause(t, clock.now())
      clock.advance(20 * MIN)
      t = resume(t, clock.now())
    }
    t = tick(t, clock.now())
    expect(t.remainingMs).toBe(7 * MIN)
  })

  it('진행 중이 아니면 일시정지가 아무것도 하지 않는다', () => {
    const clock = ticker()
    const t = idleTimer(MIN)
    expect(pause(t, clock.now())).toBe(t)
  })

  it('일시정지 상태가 아니면 재개가 아무것도 하지 않는다', () => {
    const clock = ticker()
    const t = start(idleTimer(MIN), clock.now())
    expect(resume(t, clock.now())).toBe(t)
  })

  it('시간이 다 된 뒤 일시정지를 누르면 끝난 상태가 된다', () => {
    const clock = ticker()
    let t = start(idleTimer(MIN), clock.now())
    clock.advance(2 * MIN)
    t = pause(t, clock.now())
    expect(t.phase).toBe('done')
    expect(t.remainingMs).toBe(0)
  })

  it('이미 진행 중이면 시작이 남은 시간을 되돌리지 않는다', () => {
    const clock = ticker()
    let t = start(idleTimer(3 * MIN), clock.now())
    clock.advance(MIN)
    t = tick(t, clock.now())
    t = start(t, clock.now())
    expect(t.remainingMs).toBe(2 * MIN)
  })

  it('일시정지 뒤 시작을 눌러도 남은 시간부터 이어간다', () => {
    const clock = ticker()
    let t = start(idleTimer(3 * MIN), clock.now())
    clock.advance(MIN)
    t = pause(t, clock.now())
    t = start(t, clock.now())
    expect(t.phase).toBe('running')
    expect(t.remainingMs).toBe(2 * MIN)
  })

  it('끝난 뒤 시작을 누르면 처음 길이부터 다시 간다', () => {
    const clock = ticker()
    let t = start(idleTimer(2 * MIN), clock.now())
    clock.advance(3 * MIN)
    t = tick(t, clock.now())
    t = start(t, clock.now())
    expect(t.phase).toBe('running')
    expect(t.remainingMs).toBe(2 * MIN)
  })
})

describe('타이머 — 리셋', () => {
  it('진행 중에 리셋하면 마지막으로 설정한 길이로 돌아간다', () => {
    const clock = ticker()
    let t = start(setDuration(idleTimer(MIN), 7 * MIN), clock.now())
    clock.advance(2 * MIN)
    t = tick(t, clock.now())
    t = reset(t)
    expect(t.phase).toBe('idle')
    expect(t.remainingMs).toBe(7 * MIN)
  })

  it('끝난 뒤 리셋해도 같은 길이로 돌아간다', () => {
    const clock = ticker()
    let t = start(idleTimer(3 * MIN), clock.now())
    clock.advance(10 * MIN)
    t = tick(t, clock.now())
    t = reset(t)
    expect(t.phase).toBe('idle')
    expect(t.durationMs).toBe(3 * MIN)
    expect(t.remainingMs).toBe(3 * MIN)
  })

  it('리셋한 뒤 다시 시작하면 처음부터 흐른다', () => {
    const clock = ticker()
    let t = start(idleTimer(MIN), clock.now())
    clock.advance(30_000)
    t = reset(tick(t, clock.now()))
    t = start(t, clock.now())
    clock.advance(10_000)
    t = tick(t, clock.now())
    expect(t.remainingMs).toBe(50_000)
  })
})

describe('남은 시간 표기', () => {
  it('1시간 미만은 M:SS로 쓴다', () => {
    expect(formatRemaining(5 * MIN)).toBe('5:00')
    expect(formatRemaining(65_000)).toBe('1:05')
    expect(formatRemaining(9000)).toBe('0:09')
  })

  it('1시간 이상은 H:MM:SS로 쓴다', () => {
    expect(formatRemaining(3_600_000)).toBe('1:00:00')
    expect(formatRemaining(3_725_000)).toBe('1:02:05')
    expect(formatRemaining(36_000_000)).toBe('10:00:00')
  })

  it('남은 시간은 올림해 보여준다', () => {
    expect(formatRemaining(400)).toBe('0:01')
    expect(formatRemaining(1)).toBe('0:01')
    expect(formatRemaining(59_400)).toBe('1:00')
  })

  it('1초 미만이 남은 59분 59.5초는 1:00:00이 된다', () => {
    expect(formatRemaining(3_599_999)).toBe('1:00:00')
  })

  it('0과 음수는 0:00이다', () => {
    expect(formatRemaining(0)).toBe('0:00')
    expect(formatRemaining(-5000)).toBe('0:00')
  })

  it('진행 중인 타이머의 표기가 0:00으로 먼저 떨어지지 않는다', () => {
    const clock = ticker()
    let t = start(idleTimer(3000), clock.now())
    clock.advance(2600)
    t = tick(t, clock.now())
    expect(t.phase).toBe('running')
    expect(formatRemaining(t.remainingMs)).toBe('0:01')

    clock.advance(400)
    t = tick(t, clock.now())
    expect(t.phase).toBe('done')
    expect(formatRemaining(t.remainingMs)).toBe('0:00')
  })
})

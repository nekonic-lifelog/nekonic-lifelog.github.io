import { beforeEach, describe, expect, it } from 'vitest'
import type { Snapshot } from '../src/data/store'
import { fixedClock } from '../src/lib/clock'
import { rangeFor, todoStats } from '../src/lib/stats'
import { DEFAULT_SETTINGS } from '../src/lib/types'
import { makeTodo, resetIds } from './factories'

const BOUNDARY = 4
const NOW = '2026-03-12T20:00:00+09:00'
const TODAY = '2026-03-12'
const WEEK = rangeFor('week', TODAY)

const opts = (now = NOW) => ({ boundaryHour: BOUNDARY, clock: fixedClock(now) })

function snap(partial: Partial<Snapshot> = {}): Snapshot {
  return {
    definitions: [],
    records: [],
    todos: [],
    projects: [],
    books: [],
    journal: [],
    settings: DEFAULT_SETTINGS,
    ...partial,
  }
}

function done(overrides: Parameters<typeof makeTodo>[0] = {}) {
  return makeTodo({ status: 'done', ...overrides })
}

beforeEach(resetIds)

describe('todoStats — 기간 완료 수', () => {
  it('doneAt이 기간 안에 든 완료만 센다', () => {
    const snapshot = snap({
      todos: [
        done({ doneAt: '2026-03-10T10:00:00+09:00' }),
        done({ doneAt: '2026-03-11T10:00:00+09:00' }),
        done({ doneAt: '2026-03-05T10:00:00+09:00' }),
      ],
    })

    expect(todoStats(snapshot, WEEK, opts()).completed).toBe(2)
  })

  it('완료가 아닌 것은 doneAt이 있어도 세지 않는다', () => {
    const snapshot = snap({
      todos: [makeTodo({ status: 'doing', doneAt: '2026-03-10T10:00:00+09:00' })],
    })

    expect(todoStats(snapshot, WEEK, opts()).completed).toBe(0)
  })

  it('새벽 2시에 끝낸 것은 전날 완료로 센다', () => {
    const snapshot = snap({ todos: [done({ doneAt: '2026-03-09T02:00:00+09:00' })] })

    expect(todoStats(snapshot, WEEK, opts()).completed).toBe(0)
    expect(
      todoStats(snapshot, { from: '2026-03-02', to: '2026-03-08' }, opts()).completed,
    ).toBe(1)
  })

  it('삭제된 할 일은 어디에도 세지 않는다', () => {
    const snapshot = snap({
      todos: [
        { ...done({ doneAt: '2026-03-10T10:00:00+09:00' }), deleted: true },
        { ...makeTodo({ createdAt: '2026-01-01T09:00:00+09:00' }), deleted: true },
      ],
    })
    const stat = todoStats(snapshot, WEEK, opts())

    expect(stat.completed).toBe(0)
    expect(stat.open).toBe(0)
    expect(stat.oldestOpen).toBeNull()
  })

  it('기간 안에 만든 수를 따로 센다', () => {
    const snapshot = snap({
      todos: [
        makeTodo({ createdAt: '2026-03-10T09:00:00+09:00' }),
        makeTodo({ createdAt: '2026-03-01T09:00:00+09:00' }),
      ],
    })

    expect(todoStats(snapshot, WEEK, opts()).created).toBe(1)
  })
})

describe('todoStats — doneAt이 없는 완료 건', () => {
  it('기간 집계에 넣지 않는다 — 만든 날짜를 완료 시각으로 대신 쓰지 않는다', () => {
    const snapshot = snap({
      todos: [done({ createdAt: '2026-03-10T09:00:00+09:00' })],
    })
    const stat = todoStats(snapshot, WEEK, opts())

    expect(stat.completed).toBe(0)
    expect(stat.leadTimeSamples).toBe(0)
    expect(stat.judged).toBe(0)
  })

  it('조용히 사라지지 않게 따로 센다', () => {
    const snapshot = snap({
      todos: [
        done({ createdAt: '2026-03-10T09:00:00+09:00' }),
        done({ createdAt: '2025-08-01T09:00:00+09:00' }),
        done({ doneAt: '2026-03-10T10:00:00+09:00' }),
      ],
    })

    expect(todoStats(snapshot, WEEK, opts()).doneWithoutTime).toBe(2)
  })

  it('열려 있는 것으로도 세지 않는다', () => {
    const snapshot = snap({ todos: [done({ createdAt: '2026-01-01T09:00:00+09:00' })] })
    const stat = todoStats(snapshot, WEEK, opts())

    expect(stat.open).toBe(0)
    expect(stat.oldestOpen).toBeNull()
  })
})

describe('todoStats — 기한 준수율', () => {
  it('기한 안에 끝내면 준수다', () => {
    const snapshot = snap({
      todos: [
        done({ dueAt: '2026-03-11T12:00:00+09:00', doneAt: '2026-03-10T10:00:00+09:00' }),
      ],
    })
    const stat = todoStats(snapshot, WEEK, opts())

    expect(stat.onTime).toBe(1)
    expect(stat.late).toBe(0)
    expect(stat.onTimePercent).toBe(100)
  })

  it('기한 당일 밤에 끝낸 것도 준수다 — 날짜로 비교한다', () => {
    const snapshot = snap({
      todos: [
        done({ dueAt: '2026-03-10T12:00:00+09:00', doneAt: '2026-03-10T22:00:00+09:00' }),
      ],
    })
    const stat = todoStats(snapshot, WEEK, opts())

    expect(stat.onTime).toBe(1)
    expect(stat.late).toBe(0)
  })

  it('기한 다음 날에 끝내면 미준수다', () => {
    const snapshot = snap({
      todos: [
        done({ dueAt: '2026-03-10T12:00:00+09:00', doneAt: '2026-03-11T09:00:00+09:00' }),
      ],
    })
    const stat = todoStats(snapshot, WEEK, opts())

    expect(stat.onTime).toBe(0)
    expect(stat.late).toBe(1)
    expect(stat.onTimePercent).toBe(0)
  })

  it('반은 지키고 반은 놓치면 50퍼센트다', () => {
    const snapshot = snap({
      todos: [
        done({ dueAt: '2026-03-11T12:00:00+09:00', doneAt: '2026-03-10T10:00:00+09:00' }),
        done({ dueAt: '2026-03-09T12:00:00+09:00', doneAt: '2026-03-11T10:00:00+09:00' }),
      ],
    })

    expect(todoStats(snapshot, WEEK, opts()).onTimePercent).toBe(50)
  })
})

describe('todoStats — 기한이 없는 건', () => {
  it('준수율의 분모에 들어가지 않는다', () => {
    const snapshot = snap({
      todos: [
        done({ dueAt: '2026-03-11T12:00:00+09:00', doneAt: '2026-03-10T10:00:00+09:00' }),
        done({ doneAt: '2026-03-10T10:00:00+09:00' }),
        done({ doneAt: '2026-03-11T10:00:00+09:00' }),
      ],
    })
    const stat = todoStats(snapshot, WEEK, opts())

    expect(stat.completed).toBe(3)
    expect(stat.judged).toBe(1)
    expect(stat.onTimePercent).toBe(100)
    expect(stat.noDue).toBe(2)
  })

  it('판정할 것이 하나도 없으면 0퍼센트가 아니라 없음이다', () => {
    const snapshot = snap({ todos: [done({ doneAt: '2026-03-10T10:00:00+09:00' })] })
    const stat = todoStats(snapshot, WEEK, opts())

    expect(stat.judged).toBe(0)
    expect(stat.onTimePercent).toBeNull()
  })

  it('완료가 하나도 없어도 준수율은 없음이다', () => {
    expect(todoStats(snap(), WEEK, opts()).onTimePercent).toBeNull()
  })

  it('기한이 없어도 리드타임에는 들어간다', () => {
    const snapshot = snap({
      todos: [
        done({
          createdAt: '2026-03-08T09:00:00+09:00',
          doneAt: '2026-03-10T10:00:00+09:00',
        }),
      ],
    })
    const stat = todoStats(snapshot, WEEK, opts())

    expect(stat.leadTimeSamples).toBe(1)
    expect(stat.leadTimeDays).toBe(2)
  })
})

describe('todoStats — 리드타임 중앙값', () => {
  function lead(spans: [string, string][]) {
    return snap({
      todos: spans.map(([createdAt, doneAt]) => done({ createdAt, doneAt })),
    })
  }

  it('홀수 개면 가운데 값이다', () => {
    const snapshot = lead([
      ['2026-03-09T09:00:00+09:00', '2026-03-09T18:00:00+09:00'],
      ['2026-03-05T09:00:00+09:00', '2026-03-10T18:00:00+09:00'],
      ['2026-03-08T09:00:00+09:00', '2026-03-10T18:00:00+09:00'],
    ])
    const stat = todoStats(snapshot, WEEK, opts())

    expect(stat.leadTimeSamples).toBe(3)
    expect(stat.leadTimeDays).toBe(2)
  })

  it('짝수 개면 가운데 두 값의 평균이다', () => {
    const snapshot = lead([
      ['2026-03-10T09:00:00+09:00', '2026-03-10T18:00:00+09:00'],
      ['2026-03-09T09:00:00+09:00', '2026-03-10T18:00:00+09:00'],
      ['2026-03-08T09:00:00+09:00', '2026-03-10T18:00:00+09:00'],
      ['2026-03-05T09:00:00+09:00', '2026-03-10T18:00:00+09:00'],
    ])

    expect(todoStats(snapshot, WEEK, opts()).leadTimeDays).toBe(1.5)
  })

  it('같은 날 만들고 끝내면 0일이다', () => {
    const snapshot = lead([['2026-03-10T09:00:00+09:00', '2026-03-10T23:00:00+09:00']])

    expect(todoStats(snapshot, WEEK, opts()).leadTimeDays).toBe(0)
  })

  it('평균이 아니라 중앙값이다 — 한 건이 길어도 끌려가지 않는다', () => {
    const snapshot = lead([
      ['2026-03-10T09:00:00+09:00', '2026-03-10T18:00:00+09:00'],
      ['2026-03-09T09:00:00+09:00', '2026-03-10T18:00:00+09:00'],
      ['2025-03-10T09:00:00+09:00', '2026-03-10T18:00:00+09:00'],
    ])

    expect(todoStats(snapshot, WEEK, opts()).leadTimeDays).toBe(1)
  })

  it('표본이 없으면 0일이 아니라 없음이다', () => {
    expect(todoStats(snap(), WEEK, opts()).leadTimeDays).toBeNull()
  })

  it('하루 경계로 잰다 — 새벽에 끝낸 것은 전날까지의 길이다', () => {
    const snapshot = lead([['2026-03-09T09:00:00+09:00', '2026-03-11T02:00:00+09:00']])

    expect(todoStats(snapshot, WEEK, opts()).leadTimeDays).toBe(1)
  })
})

describe('todoStats — 소급 입력', () => {
  it('만든 시각보다 앞서 끝난 것은 리드타임 0일로 센다', () => {
    const snapshot = snap({
      todos: [
        done({
          createdAt: '2026-03-11T09:00:00+09:00',
          doneAt: '2026-03-10T08:00:00+09:00',
        }),
      ],
    })
    const stat = todoStats(snapshot, WEEK, opts())

    expect(stat.leadTimeSamples).toBe(1)
    expect(stat.leadTimeDays).toBe(0)
  })

  it('소급 입력한 건수를 따로 센다', () => {
    const snapshot = snap({
      todos: [
        done({
          createdAt: '2026-03-11T09:00:00+09:00',
          doneAt: '2026-03-10T08:00:00+09:00',
        }),
        done({
          createdAt: '2026-03-09T09:00:00+09:00',
          doneAt: '2026-03-10T08:00:00+09:00',
        }),
      ],
    })
    const stat = todoStats(snapshot, WEEK, opts())

    expect(stat.backfilled).toBe(1)
    expect(stat.completed).toBe(2)
  })

  it('소급 입력해도 기한 판정은 그대로 한다', () => {
    const snapshot = snap({
      todos: [
        done({
          createdAt: '2026-03-11T09:00:00+09:00',
          dueAt: '2026-03-09T12:00:00+09:00',
          doneAt: '2026-03-10T08:00:00+09:00',
        }),
      ],
    })
    const stat = todoStats(snapshot, WEEK, opts())

    expect(stat.judged).toBe(1)
    expect(stat.late).toBe(1)
  })
})

describe('todoStats — 가장 오래 열려 있는 것', () => {
  it('열린 것 가운데 가장 먼저 만든 것을 나이와 함께 준다', () => {
    const snapshot = snap({
      todos: [
        makeTodo({ title: '어제 것', createdAt: '2026-03-11T09:00:00+09:00' }),
        makeTodo({ title: '묵은 것', createdAt: '2026-02-10T09:00:00+09:00' }),
      ],
    })
    const oldest = todoStats(snapshot, WEEK, opts()).oldestOpen!

    expect(oldest.todo.title).toBe('묵은 것')
    expect(oldest.ageDays).toBe(30)
  })

  it('기간 밖에 만든 것도 대상이다 — 지금 열려 있는지가 기준이다', () => {
    const snapshot = snap({
      todos: [makeTodo({ title: '작년 것', createdAt: '2025-03-12T09:00:00+09:00' })],
    })
    const oldest = todoStats(snapshot, WEEK, opts()).oldestOpen!

    expect(oldest.todo.title).toBe('작년 것')
    expect(oldest.ageDays).toBe(365)
  })

  it('보류도 열린 것으로 센다', () => {
    const snapshot = snap({
      todos: [
        makeTodo({ title: '보류 것', status: 'held', createdAt: '2026-02-10T09:00:00+09:00' }),
        makeTodo({ title: '진행 것', status: 'doing', createdAt: '2026-03-01T09:00:00+09:00' }),
      ],
    })
    const stat = todoStats(snapshot, WEEK, opts())

    expect(stat.open).toBe(2)
    expect(stat.oldestOpen!.todo.title).toBe('보류 것')
  })

  it('열린 것이 없으면 없음이다', () => {
    const snapshot = snap({ todos: [done({ doneAt: '2026-03-10T10:00:00+09:00' })] })

    expect(todoStats(snapshot, WEEK, opts()).oldestOpen).toBeNull()
  })

  it('오늘 만든 것은 0일이다', () => {
    const snapshot = snap({ todos: [makeTodo({ createdAt: '2026-03-12T09:00:00+09:00' })] })

    expect(todoStats(snapshot, WEEK, opts()).oldestOpen!.ageDays).toBe(0)
  })
})

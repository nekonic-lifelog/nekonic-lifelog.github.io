import { beforeEach, describe, expect, it } from 'vitest'
import { fixedClock } from '../src/lib/clock'
import { logicalDay } from '../src/lib/day'
import {
  computeStreak,
  dayStatus,
  effectiveTarget,
  habitView,
  progressPercent,
  withNewTarget,
} from '../src/lib/streak'
import { dailyRecords, makeDef, makeQuantityDef, makeRecord, resetIds } from './factories'

const BOUNDARY = 4
const opts = (now: string) => ({ boundaryHour: BOUNDARY, clock: fixedClock(now) })

beforeEach(resetIds)

describe('하루 경계 — 로컬 시간 오전 4시', () => {
  it('새벽 1시 30분은 전날에 속한다', () => {
    expect(logicalDay('2026-03-10T01:30:00+09:00', BOUNDARY)).toBe('2026-03-09')
  })

  it('오전 3시 59분까지가 전날, 4시 정각부터 당일이다', () => {
    expect(logicalDay('2026-03-10T03:59:59+09:00', BOUNDARY)).toBe('2026-03-09')
    expect(logicalDay('2026-03-10T04:00:00+09:00', BOUNDARY)).toBe('2026-03-10')
  })

  it('밤 11시 59분은 당일이다', () => {
    expect(logicalDay('2026-03-10T23:59:00+09:00', BOUNDARY)).toBe('2026-03-10')
  })

  it('경계를 자정으로 바꾸면 새벽 1시 30분이 당일로 옮겨간다', () => {
    expect(logicalDay('2026-03-10T01:30:00+09:00', 0)).toBe('2026-03-10')
  })

  it('새벽에 체크한 사흘이 연속 3일로 계산된다', () => {
    const def = makeDef()
    const records = [
      makeRecord(def.id, '2026-03-10T01:30:00+09:00'),
      makeRecord(def.id, '2026-03-11T01:30:00+09:00'),
      makeRecord(def.id, '2026-03-12T01:30:00+09:00'),
    ]
    expect(computeStreak(def, records, opts('2026-03-12T02:00:00+09:00'))).toBe(3)
  })

  it('늦게 잔 날에 자정 경계면 스트릭이 끊기고, 4시 경계면 이어진다', () => {
    const def = makeDef()
    const records = [
      makeRecord(def.id, '2026-03-09T23:00:00+09:00'),
      makeRecord(def.id, '2026-03-11T01:30:00+09:00'),
    ]
    const now = '2026-03-11T05:00:00+09:00'

    expect(computeStreak(def, records, opts(now))).toBe(2)

    const midnight = { boundaryHour: 0, clock: fixedClock(now) }
    expect(computeStreak(def, records, midnight)).toBe(1)
  })
})

describe('목표 요일 건너뜀', () => {
  const monWedFri = [1, 3, 5]

  it('대상이 아닌 요일에 기록이 없어도 스트릭이 끊기지 않는다', () => {
    const def = makeDef({ targetDays: monWedFri })
    const records = dailyRecords(def.id, [
      '2026-03-02',
      '2026-03-04',
      '2026-03-06',
      '2026-03-09',
      '2026-03-11',
    ])
    expect(computeStreak(def, records, opts('2026-03-12T20:00:00+09:00'))).toBe(5)
  })

  it('대상 요일을 빠뜨리면 거기서 끊긴다', () => {
    const def = makeDef({ targetDays: monWedFri })
    const records = dailyRecords(def.id, [
      '2026-03-02',
      '2026-03-04',
      '2026-03-06',
      '2026-03-11',
    ])
    expect(computeStreak(def, records, opts('2026-03-12T20:00:00+09:00'))).toBe(1)
  })

  it('오늘이 대상 요일인데 아직 미달성이어도 스트릭을 끊지 않는다', () => {
    const def = makeDef({ targetDays: monWedFri })
    const records = dailyRecords(def.id, ['2026-03-06', '2026-03-09'])
    expect(computeStreak(def, records, opts('2026-03-11T10:00:00+09:00'))).toBe(2)
  })

  it('targetDays가 없으면 매일이 대상이다', () => {
    const def = makeDef()
    const records = dailyRecords(def.id, ['2026-03-09', '2026-03-11'])
    expect(computeStreak(def, records, opts('2026-03-11T20:00:00+09:00'))).toBe(1)
  })
})

describe('targetHistory 시점 판정', () => {
  const history = [
    { from: '2026-03-01T00:00:00+09:00', target: 1000 },
    { from: '2026-03-10T09:00:00+09:00', target: 2000 },
  ]

  it('그날 유효했던 목표를 고른다', () => {
    const def = makeQuantityDef(history)
    expect(effectiveTarget(def, '2026-03-05', BOUNDARY)).toBe(1000)
    expect(effectiveTarget(def, '2026-03-09', BOUNDARY)).toBe(1000)
    expect(effectiveTarget(def, '2026-03-10', BOUNDARY)).toBe(2000)
    expect(effectiveTarget(def, '2026-03-20', BOUNDARY)).toBe(2000)
  })

  it('가장 이른 항목보다 앞선 날은 그 항목의 목표를 쓴다', () => {
    const def = makeQuantityDef(history)
    expect(effectiveTarget(def, '2026-02-20', BOUNDARY)).toBe(1000)
  })

  it('이력 순서가 뒤섞여 들어와도 같은 결과가 나온다', () => {
    const def = makeQuantityDef([...history].reverse())
    expect(effectiveTarget(def, '2026-03-05', BOUNDARY)).toBe(1000)
    expect(effectiveTarget(def, '2026-03-10', BOUNDARY)).toBe(2000)
  })

  it('목표를 올려도 과거 달성이 소급해서 무너지지 않는다', () => {
    const def = makeQuantityDef(history)
    const records = [
      ...dailyRecords(def.id, ['2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09'], 1500),
      ...dailyRecords(def.id, ['2026-03-10', '2026-03-11', '2026-03-12'], 2500),
    ]
    expect(computeStreak(def, records, opts('2026-03-12T20:00:00+09:00'))).toBe(8)
  })

  it('같은 날 안에서 합계가 목표를 넘으면 달성이다', () => {
    const def = makeQuantityDef([{ from: '2026-03-01T00:00:00+09:00', target: 2000 }])
    const records = [
      makeRecord(def.id, '2026-03-11T09:00:00+09:00', 700),
      makeRecord(def.id, '2026-03-11T14:00:00+09:00', 700),
      makeRecord(def.id, '2026-03-11T21:00:00+09:00', 700),
    ]
    expect(computeStreak(def, records, opts('2026-03-11T23:00:00+09:00'))).toBe(1)
  })

  it('목표를 낮추면 그 이후 날만 쉬워진다', () => {
    const def = makeQuantityDef([
      { from: '2026-03-01T00:00:00+09:00', target: 2000 },
      { from: '2026-03-11T09:00:00+09:00', target: 1000 },
    ])
    const records = dailyRecords(def.id, ['2026-03-10', '2026-03-11'], 1200)
    expect(computeStreak(def, records, opts('2026-03-11T20:00:00+09:00'))).toBe(1)
  })
})

describe('목표 변경은 이력에 쌓는다', () => {
  it('다른 날에 바꾸면 점이 하나 늘어난다 — 과거 판정이 보존된다', () => {
    const history = [{ from: '2026-03-01T09:00:00+09:00', target: 1000 }]
    const next = withNewTarget(history, 2000, '2026-03-10T09:00:00+09:00', BOUNDARY)
    expect(next).toHaveLength(2)
    expect(next[0]).toEqual(history[0])
    expect(next[1]!.target).toBe(2000)
  })

  it('같은 날 안에서 여러 번 바꾸면 마지막 점을 갈아끼운다', () => {
    const history = [{ from: '2026-03-01T09:00:00+09:00', target: 1000 }]
    const once = withNewTarget(history, 2000, '2026-03-10T09:00:00+09:00', BOUNDARY)
    const twice = withNewTarget(once, 2500, '2026-03-10T21:00:00+09:00', BOUNDARY)
    expect(twice).toHaveLength(2)
    expect(twice[1]!.target).toBe(2500)
    expect(twice[0]!.target).toBe(1000)
  })

  it('새벽에 바꾸면 전날 점을 갈아끼운다 — 하루 경계를 따른다', () => {
    const history = [{ from: '2026-03-10T21:00:00+09:00', target: 2000 }]
    const next = withNewTarget(history, 2500, '2026-03-11T02:00:00+09:00', BOUNDARY)
    expect(next).toHaveLength(1)
    expect(next[0]!.target).toBe(2500)
  })

  it('빈 이력에서 시작해도 된다', () => {
    expect(withNewTarget([], 1500, '2026-03-10T09:00:00+09:00', BOUNDARY)).toEqual([
      { from: '2026-03-10T09:00:00+09:00', target: 1500 },
    ])
  })

  it('바꾼 뒤에도 과거 달성이 그대로 남는다', () => {
    const def = makeQuantityDef([{ from: '2026-03-01T00:00:00+09:00', target: 1000 }])
    const records = dailyRecords(
      def.id,
      ['2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12'],
      1500,
    )
    const now = '2026-03-12T20:00:00+09:00'
    expect(computeStreak(def, records, opts(now))).toBe(5)

    const raised = { ...def, targetHistory: withNewTarget(def.targetHistory, 2000, now, BOUNDARY) }
    expect(computeStreak(raised, records, opts(now))).toBe(4)
  })
})

describe('과거 소급 입력', () => {
  it('어제 빠뜨린 것을 오늘 채우면 스트릭이 되살아난다', () => {
    const def = makeDef()
    const before = dailyRecords(def.id, ['2026-03-09', '2026-03-10', '2026-03-12'])
    const now = '2026-03-12T21:00:00+09:00'

    expect(computeStreak(def, before, opts(now))).toBe(1)

    const backfilled = makeRecord(def.id, '2026-03-11T22:00:00+09:00', 1, { createdAt: now })
    expect(computeStreak(def, [...before, backfilled], opts(now))).toBe(4)
  })

  it('경로 판정이 아니라 `at`이 날짜 버킷을 정한다', () => {
    const def = makeDef()
    const rec = makeRecord(def.id, '2026-03-11T22:00:00+09:00', 1, {
      createdAt: '2026-03-12T21:00:00+09:00',
    })
    const view = habitView(def, [rec], opts('2026-03-12T21:00:00+09:00'))
    expect(view.recent.find((d) => d.day === '2026-03-11')?.achieved).toBe(true)
    expect(view.recent.find((d) => d.day === '2026-03-12')?.achieved).toBe(false)
  })

  it('definition 생성보다 이른 기록도 집계된다', () => {
    const def = makeDef({ createdAt: '2026-03-10T12:00:00+09:00' })
    const records = dailyRecords(def.id, ['2026-03-08', '2026-03-09', '2026-03-10'])
    expect(computeStreak(def, records, opts('2026-03-10T20:00:00+09:00'))).toBe(3)
  })

  it('tombstone 처리된 기록은 집계에서 빠진다', () => {
    const def = makeDef()
    const records = dailyRecords(def.id, ['2026-03-10', '2026-03-11'])
    expect(computeStreak(def, records, opts('2026-03-11T20:00:00+09:00'))).toBe(2)

    const deleted = records.map((r) =>
      r.at.startsWith('2026-03-10') ? { ...r, deleted: true } : r,
    )
    expect(computeStreak(def, deleted, opts('2026-03-11T20:00:00+09:00'))).toBe(1)
  })

  it('다른 definition의 기록은 섞이지 않는다', () => {
    const a = makeDef({ name: '아침 약' })
    const b = makeDef({ name: '저녁 약' })
    const records = [
      ...dailyRecords(a.id, ['2026-03-10', '2026-03-11']),
      ...dailyRecords(b.id, ['2026-03-09']),
    ]
    expect(computeStreak(a, records, opts('2026-03-11T20:00:00+09:00'))).toBe(2)
    expect(computeStreak(b, records, opts('2026-03-11T20:00:00+09:00'))).toBe(0)
  })
})

describe('기록 건수 — 합계와 구분한다', () => {
  it('합계가 0이어도 기록이 있으면 건수로 드러난다', () => {
    const def = makeQuantityDef([{ from: '2026-03-01T00:00:00+09:00', target: 2000 }])
    const records = [
      makeRecord(def.id, '2026-03-12T09:00:00+09:00', 3),
      makeRecord(def.id, '2026-03-12T10:00:00+09:00', -3),
    ]
    const status = dayStatus(def, records, '2026-03-12', opts('2026-03-12T20:00:00+09:00'))
    expect(status.total).toBe(0)
    expect(status.count).toBe(2)
    expect(status.achieved).toBe(false)
  })

  it('기록이 없으면 건수도 0이다', () => {
    const def = makeQuantityDef([{ from: '2026-03-01T00:00:00+09:00', target: 2000 }])
    const status = dayStatus(def, [], '2026-03-12', opts('2026-03-12T20:00:00+09:00'))
    expect(status.count).toBe(0)
  })

  it('check형은 value가 0이어도 건수로 달성 판정한다', () => {
    const def = makeDef()
    const records = [makeRecord(def.id, '2026-03-12T09:00:00+09:00', 0)]
    const status = dayStatus(def, records, '2026-03-12', opts('2026-03-12T20:00:00+09:00'))
    expect(status.count).toBe(1)
    expect(status.achieved).toBe(true)
  })

  it('tombstone은 건수에서도 빠진다', () => {
    const def = makeQuantityDef([{ from: '2026-03-01T00:00:00+09:00', target: 2000 }])
    const records = [
      makeRecord(def.id, '2026-03-12T09:00:00+09:00', 500),
      { ...makeRecord(def.id, '2026-03-12T10:00:00+09:00', 500), deleted: true },
    ]
    const status = dayStatus(def, records, '2026-03-12', opts('2026-03-12T20:00:00+09:00'))
    expect(status.count).toBe(1)
    expect(status.total).toBe(500)
  })
})

describe('진행률 표시', () => {
  const status = (total: number, target: number | null) => ({
    day: '2026-03-12',
    isTargetDay: true,
    total,
    count: total === 0 ? 0 : 1,
    target,
    achieved: target === null ? total > 0 : total >= target,
  })

  it('목표 대비 비율을 돌려준다', () => {
    expect(progressPercent(status(1000, 2000))).toBe(50)
    expect(progressPercent(status(500, 2000))).toBe(25)
  })

  it('아주 작은 값도 0으로 뭉개지 않는다', () => {
    const pct = progressPercent(status(6, 2000))
    expect(pct).toBeGreaterThan(0)
    expect(pct).toBeCloseTo(0.3)
  })

  it('기록이 하나도 없을 때만 0이다', () => {
    expect(progressPercent(status(0, 2000))).toBe(0)
  })

  it('목표를 넘겨도 100을 넘지 않는다', () => {
    expect(progressPercent(status(5000, 2000))).toBe(100)
  })

  it('목표가 없으면 기록 유무로만 판단한다', () => {
    expect(progressPercent(status(0, null))).toBe(0)
    expect(progressPercent(status(1, null))).toBe(100)
  })
})

describe('habitView — 오늘 화면이 쓰는 묶음', () => {
  it('최근 7일을 오래된 순으로 돌려준다', () => {
    const def = makeDef()
    const view = habitView(def, [], opts('2026-03-12T20:00:00+09:00'))
    expect(view.recent).toHaveLength(7)
    expect(view.recent[0]!.day).toBe('2026-03-06')
    expect(view.recent[6]!.day).toBe('2026-03-12')
    expect(view.today.day).toBe('2026-03-12')
  })

  it('targetDays가 있으면 대상이 아닌 날을 표시해준다', () => {
    const def = makeDef({ targetDays: [1, 3, 5] })
    const view = habitView(def, [], opts('2026-03-12T20:00:00+09:00'))
    const targets = view.recent.filter((d) => d.isTargetDay).map((d) => d.day)
    expect(targets).toEqual(['2026-03-06', '2026-03-09', '2026-03-11'])
  })

  it('quantity형은 그날 목표를 함께 돌려준다', () => {
    const def = makeQuantityDef([
      { from: '2026-03-01T00:00:00+09:00', target: 1000 },
      { from: '2026-03-10T09:00:00+09:00', target: 2000 },
    ])
    const view = habitView(def, [], opts('2026-03-12T20:00:00+09:00'))
    expect(view.recent.find((d) => d.day === '2026-03-09')?.target).toBe(1000)
    expect(view.recent.find((d) => d.day === '2026-03-12')?.target).toBe(2000)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { fixedClock } from '../src/lib/clock'
import {
  heatTotals,
  heatmapFor,
  rangeFor,
  weakestWeekday,
  weekdayStats,
  type HeatCell,
  type HeatWeek,
} from '../src/lib/stats'
import { dailyRecords, makeDef, makeQuantityDef, makeRecord, resetIds } from './factories'

const BOUNDARY = 4
const NOW = '2026-03-12T20:00:00+09:00'
const TODAY = '2026-03-12'
const MONTH = rangeFor('month', TODAY)
const WEEK = rangeFor('week', TODAY)

const opts = (now = NOW) => ({ boundaryHour: BOUNDARY, clock: fixedClock(now) })

function cellOn(weeks: HeatWeek[], day: string): HeatCell {
  for (const week of weeks) {
    for (const cell of week.cells) {
      if (cell !== null && cell.day === day) return cell
    }
  }
  throw new Error(`히트맵에 ${day} 칸이 없다`)
}

function daysOf(weeks: HeatWeek[]): string[] {
  return weeks.flatMap((w) => w.cells.filter((c): c is HeatCell => c !== null).map((c) => c.day))
}

beforeEach(resetIds)

describe('heatmapFor — 주 단위 열로 자른다', () => {
  it('한 주는 월요일에서 일요일까지 일곱 칸이다', () => {
    const def = makeDef()
    const weeks = heatmapFor(def, [], WEEK, opts())

    expect(weeks).toHaveLength(1)
    expect(weeks[0]!.from).toBe('2026-03-09')
    expect(weeks[0]!.cells.map((c) => c?.day ?? null)).toEqual([
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
      '2026-03-12',
      '2026-03-13',
      '2026-03-14',
      '2026-03-15',
    ])
  })

  it('달의 첫 주는 앞이 비고 마지막 주는 뒤가 빈다', () => {
    const def = makeDef()
    const weeks = heatmapFor(def, [], MONTH, opts())

    expect(weeks).toHaveLength(6)
    expect(weeks[0]!.from).toBe('2026-02-23')
    expect(weeks[0]!.cells.slice(0, 6).every((c) => c === null)).toBe(true)
    expect(weeks[0]!.cells[6]!.day).toBe('2026-03-01')
    expect(weeks[5]!.cells[2]).toBeNull()
    expect(weeks[5]!.cells[1]!.day).toBe('2026-03-31')
  })

  it('구간의 모든 날이 빠짐없이 한 번씩 들어간다', () => {
    const weeks = heatmapFor(makeDef(), [], MONTH, opts())

    expect(daysOf(weeks)).toHaveLength(31)
    expect(new Set(daysOf(weeks)).size).toBe(31)
    expect(daysOf(weeks)[0]).toBe('2026-03-01')
  })

  it('한 해도 주 단위로만 잘린다', () => {
    const weeks = heatmapFor(makeDef(), [], rangeFor('year', TODAY), opts())

    expect(daysOf(weeks)).toHaveLength(365)
    expect(weeks.every((w) => w.cells.length === 7)).toBe(true)
  })
})

describe('heatmapFor — 하루 경계', () => {
  it('새벽 2시 기록은 전날 칸에 들어간다', () => {
    const def = makeDef()
    const weeks = heatmapFor(def, [makeRecord(def.id, '2026-03-10T02:00:00+09:00')], MONTH, opts())

    expect(cellOn(weeks, '2026-03-09').count).toBe(1)
    expect(cellOn(weeks, '2026-03-09').achieved).toBe(true)
    expect(cellOn(weeks, '2026-03-10').count).toBe(0)
    expect(cellOn(weeks, '2026-03-10').achieved).toBe(false)
  })

  it('경계 시각 직후의 기록은 그날 칸이다', () => {
    const def = makeDef()
    const weeks = heatmapFor(def, [makeRecord(def.id, '2026-03-10T04:00:00+09:00')], MONTH, opts())

    expect(cellOn(weeks, '2026-03-10').count).toBe(1)
    expect(cellOn(weeks, '2026-03-09').count).toBe(0)
  })
})

describe('heatmapFor — 칸의 상태', () => {
  it('오늘 뒤의 날은 아직 오지 않은 칸이다', () => {
    const weeks = heatmapFor(makeDef(), [], MONTH, opts())

    expect(cellOn(weeks, '2026-03-12').future).toBe(false)
    expect(cellOn(weeks, '2026-03-13').future).toBe(true)
  })

  it('대상 요일이 아닌 칸은 표시가 다르다', () => {
    const def = makeDef({ targetDays: [1, 3, 5] })
    const weeks = heatmapFor(def, [], MONTH, opts())

    expect(cellOn(weeks, '2026-03-09').isTargetDay).toBe(true)
    expect(cellOn(weeks, '2026-03-10').isTargetDay).toBe(false)
  })

  it('만들기 전과 오늘 뒤와 대상 아닌 날은 세지 않는다', () => {
    const def = makeDef({ targetDays: [1], createdAt: '2026-03-09T09:00:00+09:00' })
    const weeks = heatmapFor(def, [], MONTH, opts())

    expect(cellOn(weeks, '2026-03-02').counted).toBe(false)
    expect(cellOn(weeks, '2026-03-09').counted).toBe(true)
    expect(cellOn(weeks, '2026-03-10').counted).toBe(false)
    expect(cellOn(weeks, '2026-03-16').counted).toBe(false)
  })

  it('수량 습관은 그날 합계가 목표에 닿아야 달성이다', () => {
    const def = makeQuantityDef([{ from: '2026-03-01T00:00:00+09:00', target: 1000 }])
    const records = [
      makeRecord(def.id, '2026-03-09T09:00:00+09:00', 600),
      makeRecord(def.id, '2026-03-09T18:00:00+09:00', 500),
      makeRecord(def.id, '2026-03-10T09:00:00+09:00', 300),
    ]
    const weeks = heatmapFor(def, records, MONTH, opts())

    expect(cellOn(weeks, '2026-03-09').value).toBe(1100)
    expect(cellOn(weeks, '2026-03-09').achieved).toBe(true)
    expect(cellOn(weeks, '2026-03-10').value).toBe(300)
    expect(cellOn(weeks, '2026-03-10').achieved).toBe(false)
  })

  it('삭제된 기록과 다른 정의의 기록은 칸에 들어오지 않는다', () => {
    const def = makeDef()
    const other = makeDef({ name: '다른 것' })
    const records = [
      { ...makeRecord(def.id, '2026-03-09T09:00:00+09:00'), deleted: true },
      makeRecord(other.id, '2026-03-10T09:00:00+09:00'),
    ]
    const weeks = heatmapFor(def, records, MONTH, opts())

    expect(cellOn(weeks, '2026-03-09').count).toBe(0)
    expect(cellOn(weeks, '2026-03-10').count).toBe(0)
  })
})

describe('heatTotals — 히트맵 한 줄 요약', () => {
  it('세는 칸과 달성한 칸과 기록한 날을 센다', () => {
    const def = makeDef({ createdAt: '2026-03-01T09:00:00+09:00' })
    const records = dailyRecords(def.id, ['2026-03-02', '2026-03-04', '2026-03-09'])
    const totals = heatTotals(heatmapFor(def, records, MONTH, opts()))

    expect(totals.targetDays).toBe(12)
    expect(totals.achievedDays).toBe(3)
    expect(totals.recordedDays).toBe(3)
  })

  it('대상 요일만 분모로 센다', () => {
    const def = makeDef({ targetDays: [1], createdAt: '2026-03-01T09:00:00+09:00' })
    const totals = heatTotals(heatmapFor(def, [], MONTH, opts()))

    expect(totals.targetDays).toBe(2)
  })

  it('기록이 없으면 0이다', () => {
    const totals = heatTotals(heatmapFor(makeDef(), [], MONTH, opts()))

    expect(totals.achievedDays).toBe(0)
    expect(totals.recordedDays).toBe(0)
  })
})

describe('weekdayStats — 어느 요일에 무너지는가', () => {
  it('월요일부터 일요일까지 일곱 개를 준다', () => {
    const stats = weekdayStats(makeDef(), [], MONTH, opts())

    expect(stats.map((s) => s.label)).toEqual(['월', '화', '수', '목', '금', '토', '일'])
    expect(stats.map((s) => s.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0])
  })

  it('요일별로 대상 일수와 달성 일수를 나눈다', () => {
    const def = makeDef({ createdAt: '2026-03-01T09:00:00+09:00' })
    const records = dailyRecords(def.id, ['2026-03-02', '2026-03-09', '2026-03-04'])
    const stats = weekdayStats(def, records, MONTH, opts())
    const mon = stats[0]!
    const wed = stats[2]!

    expect([mon.targetDays, mon.achievedDays, mon.percent]).toEqual([2, 2, 100])
    expect([wed.targetDays, wed.achievedDays, wed.percent]).toEqual([2, 1, 50])
  })

  it('targetDays를 존중한다 — 대상이 아닌 요일은 분모가 0이다', () => {
    const def = makeDef({ targetDays: [1, 3, 5], createdAt: '2026-03-01T09:00:00+09:00' })
    const stats = weekdayStats(def, dailyRecords(def.id, ['2026-03-03']), MONTH, opts())

    expect(stats[1]!.label).toBe('화')
    expect(stats[1]!.targetDays).toBe(0)
    expect(stats[1]!.achievedDays).toBe(0)
    expect(stats[1]!.percent).toBe(0)
    expect(stats[0]!.targetDays).toBe(2)
    expect(stats[4]!.targetDays).toBe(1)
  })

  it('아직 오지 않은 날은 분모에서 빠진다', () => {
    const def = makeDef({ createdAt: '2026-03-01T09:00:00+09:00' })
    const stats = weekdayStats(def, [], MONTH, opts())

    expect(stats[0]!.targetDays).toBe(2)
    expect(stats[3]!.targetDays).toBe(2)
    expect(stats[4]!.targetDays).toBe(1)
  })

  it('만들기 전 날은 분모에 들어가지 않는다', () => {
    const def = makeDef({ createdAt: '2026-03-09T09:00:00+09:00' })
    const stats = weekdayStats(def, [], MONTH, opts())

    expect(stats[0]!.targetDays).toBe(1)
  })

  it('소급 입력한 기록이 있으면 그날부터 센다', () => {
    const def = makeDef({ createdAt: '2026-03-09T09:00:00+09:00' })
    const stats = weekdayStats(def, dailyRecords(def.id, ['2026-03-02']), MONTH, opts())

    expect(stats[0]!.targetDays).toBe(2)
    expect(stats[0]!.achievedDays).toBe(1)
  })
})

describe('weakestWeekday — 가장 낮은 요일', () => {
  it('대상 일수가 있는 요일 가운데 달성률이 가장 낮은 것을 준다', () => {
    const def = makeDef({ createdAt: '2026-03-01T09:00:00+09:00' })
    const records = dailyRecords(def.id, [
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
      '2026-03-12',
    ])
    const weakest = weakestWeekday(weekdayStats(def, records, MONTH, opts()))

    expect(weakest!.label).toBe('수')
    expect(weakest!.percent).toBe(50)
  })

  it('같은 값이면 앞선 요일을 준다', () => {
    const def = makeDef({ createdAt: '2026-03-01T09:00:00+09:00' })
    const records = dailyRecords(def.id, [
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ])
    const weakest = weakestWeekday(weekdayStats(def, records, MONTH, opts()))

    expect(weakest!.label).toBe('수')
    expect(weakest!.percent).toBe(50)
  })

  it('대상 일수가 0인 요일은 후보가 아니다', () => {
    const def = makeDef({ targetDays: [1], createdAt: '2026-03-01T09:00:00+09:00' })
    const weakest = weakestWeekday(weekdayStats(def, [], MONTH, opts()))

    expect(weakest!.label).toBe('월')
  })

  it('셀 것이 하나도 없으면 없음이다', () => {
    const def = makeDef({ createdAt: '2026-04-01T09:00:00+09:00' })

    expect(weakestWeekday(weekdayStats(def, [], MONTH, opts()))).toBeNull()
  })
})

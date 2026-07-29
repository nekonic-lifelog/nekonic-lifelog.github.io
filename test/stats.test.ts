// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Snapshot, Store } from '../src/data/store'
import { fixedClock } from '../src/lib/clock'
import {
  daysIn,
  habitStats,
  journalStats,
  longestStreakIn,
  rangeFor,
  readingStats,
  summaryFor,
  type HabitStat,
  type Range,
} from '../src/lib/stats'
import { DEFAULT_SETTINGS } from '../src/lib/types'
import { Stats } from '../src/screens/Stats'
import { AppProvider } from '../src/state/app'
import {
  dailyRecords,
  makeBook,
  makeDef,
  makeJournal,
  makeQuantityDef,
  makeRecord,
  resetIds,
} from './factories'

const BOUNDARY = 4
const NOW = '2026-03-12T20:00:00+09:00'
const TODAY = '2026-03-12'

const opts = (now: string) => ({ boundaryHour: BOUNDARY, clock: fixedClock(now) })

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

function memoryStore(snapshot: Snapshot): Store {
  return {
    deviceId: async () => 'test-device',
    adoptDeviceId: async () => undefined,
    loadAll: async () => snapshot,
    put: async () => undefined,
    putSettings: async () => undefined,
    replaceAll: async () => undefined,
  }
}

function mount(snapshot: Snapshot, now = NOW) {
  return render(
    createElement(AppProvider, {
      store: memoryStore(snapshot),
      clock: fixedClock(now),
      children: createElement(Stats),
    }),
  )
}

const only = (stats: HabitStat[]): HabitStat => {
  expect(stats).toHaveLength(1)
  return stats[0]!
}

beforeEach(resetIds)
afterEach(cleanup)

describe('기간 경계 — 주는 월요일에 시작한다', () => {
  it('주 중간에서도 그 주의 월요일부터 일요일까지다', () => {
    expect(rangeFor('week', '2026-03-12')).toEqual({
      from: '2026-03-09',
      to: '2026-03-15',
    })
  })

  it('일요일은 그 주의 마지막 날이지 첫날이 아니다', () => {
    expect(rangeFor('week', '2026-03-15')).toEqual({
      from: '2026-03-09',
      to: '2026-03-15',
    })
  })

  it('월요일이면 그날이 시작이다', () => {
    expect(rangeFor('week', '2026-03-09')).toEqual({
      from: '2026-03-09',
      to: '2026-03-15',
    })
  })

  it('주는 달을 넘어가도 7일이다', () => {
    const range = rangeFor('week', '2026-04-01')
    expect(range).toEqual({ from: '2026-03-30', to: '2026-04-05' })
    expect(daysIn(range)).toHaveLength(7)
  })
})

describe('기간 경계 — 월과 연', () => {
  it('월은 1일부터 말일까지다', () => {
    expect(rangeFor('month', '2026-03-12')).toEqual({
      from: '2026-03-01',
      to: '2026-03-31',
    })
  })

  it('30일로 끝나는 달을 31일로 늘리지 않는다', () => {
    expect(rangeFor('month', '2026-04-30')).toEqual({
      from: '2026-04-01',
      to: '2026-04-30',
    })
  })

  it('평년 2월은 28일에서 끝난다', () => {
    const range = rangeFor('month', '2026-02-10')
    expect(range).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(daysIn(range)).toHaveLength(28)
  })

  it('윤년 2월은 29일에서 끝난다', () => {
    const range = rangeFor('month', '2024-02-10')
    expect(range).toEqual({ from: '2024-02-01', to: '2024-02-29' })
    expect(daysIn(range)).toHaveLength(29)
  })

  it('12월은 해를 넘기지 않는다', () => {
    expect(rangeFor('month', '2026-12-31')).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    })
  })

  it('연은 1월 1일부터 12월 31일까지다', () => {
    expect(rangeFor('year', '2026-07-04')).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    })
  })

  it('윤년은 366일이다', () => {
    expect(daysIn(rangeFor('year', '2024-02-29'))).toHaveLength(366)
    expect(daysIn(rangeFor('year', '2026-02-28'))).toHaveLength(365)
  })

  it('뒤집힌 구간은 빈 목록이다', () => {
    expect(daysIn({ from: '2026-03-12', to: '2026-03-09' })).toEqual([])
  })
})

describe('하루 경계 — 새벽 기록은 전날로 간다', () => {
  it('새벽 2시 기록이 전날에 집계된다', () => {
    const def = makeDef()
    const records = [makeRecord(def.id, '2026-03-10T02:00:00+09:00')]

    expect(
      longestStreakIn(def, records, { from: '2026-03-09', to: '2026-03-09' }, BOUNDARY),
    ).toBe(1)
    expect(
      longestStreakIn(def, records, { from: '2026-03-10', to: '2026-03-10' }, BOUNDARY),
    ).toBe(0)
  })

  it('새벽 2시 일기는 전날 일기로 센다', () => {
    const snapshot = snap({ journal: [makeJournal({ at: '2026-03-10T02:00:00+09:00' })] })

    expect(
      journalStats(snapshot, { from: '2026-03-09', to: '2026-03-09' }, BOUNDARY).diaryDays,
    ).toBe(1)
    expect(
      journalStats(snapshot, { from: '2026-03-10', to: '2026-03-10' }, BOUNDARY).diaryDays,
    ).toBe(0)
  })

  it('새벽 독서 기록도 전날 페이지로 붙는다', () => {
    const def = makeDef({ hidden: true, name: '토지 독서' })
    const book = makeBook({ defId: def.id })
    const snapshot = snap({
      definitions: [def],
      books: [book],
      records: [makeRecord(def.id, '2026-03-10T02:00:00+09:00', 40)],
    })

    expect(
      readingStats(snapshot, { from: '2026-03-09', to: '2026-03-09' }, BOUNDARY).pagesRead,
    ).toBe(40)
    expect(
      readingStats(snapshot, { from: '2026-03-10', to: '2026-03-10' }, BOUNDARY).pagesRead,
    ).toBe(0)
  })
})

describe('habitStats — 분모', () => {
  it('targetDays가 있으면 대상 요일 수가 분모다', () => {
    const def = makeDef({ targetDays: [1, 3, 5] })
    const snapshot = snap({ definitions: [def] })
    const stat = only(
      habitStats(snapshot, rangeFor('month', '2026-03-31'), opts('2026-03-31T20:00:00+09:00')),
    )

    expect(stat.targetDays).toBe(13)
    expect(stat.achievedDays).toBe(0)
  })

  it('targetDays가 없으면 지나간 모든 날이 분모다', () => {
    const def = makeDef()
    const snapshot = snap({ definitions: [def] })
    const stat = only(
      habitStats(snapshot, rangeFor('month', '2026-03-31'), opts('2026-03-31T20:00:00+09:00')),
    )

    expect(stat.targetDays).toBe(31)
  })

  it('아직 오지 않은 날은 분모에서 빠진다', () => {
    const def = makeDef()
    const snapshot = snap({ definitions: [def] })
    const stat = only(habitStats(snapshot, rangeFor('week', TODAY), opts(NOW)))

    expect(stat.targetDays).toBe(4)
  })

  it('대상 요일이 아닌 날의 기록은 분자에 들어가지 않는다', () => {
    const def = makeDef({ targetDays: [1, 3, 5] })
    const snapshot = snap({
      definitions: [def],
      records: dailyRecords(def.id, ['2026-03-10', '2026-03-12']),
    })
    const stat = only(habitStats(snapshot, rangeFor('week', TODAY), opts(NOW)))

    expect(stat.targetDays).toBe(2)
    expect(stat.achievedDays).toBe(0)
  })

  it('대상 일수가 0이면 percent는 0이다', () => {
    const def = makeDef({ targetDays: [0] })
    const snapshot = snap({ definitions: [def] })
    const range: Range = { from: '2026-03-09', to: '2026-03-11' }
    const stat = only(habitStats(snapshot, range, opts(NOW)))

    expect(stat.targetDays).toBe(0)
    expect(Number.isNaN(stat.percent)).toBe(false)
    expect(stat.percent).toBe(0)
  })
})

describe('habitStats — 만들기 전은 분모가 아니다', () => {
  it('오늘 만든 습관의 월간 분모는 그 달 전체가 아니라 하루다', () => {
    const def = makeDef({ createdAt: '2026-03-12T09:00:00+09:00' })
    const stat = only(
      habitStats(snap({ definitions: [def] }), rangeFor('month', TODAY), opts(NOW)),
    )

    expect(stat.targetDays).toBe(1)
    expect(stat.achievedDays).toBe(0)
  })

  it('만든 날에 남긴 기록이면 100%다', () => {
    const def = makeDef({ createdAt: '2026-03-12T09:00:00+09:00' })
    const snapshot = snap({
      definitions: [def],
      records: dailyRecords(def.id, ['2026-03-12'], 1, '10:00:00'),
    })
    const stat = only(habitStats(snapshot, rangeFor('month', TODAY), opts(NOW)))

    expect(stat.targetDays).toBe(1)
    expect(stat.achievedDays).toBe(1)
    expect(stat.percent).toBe(100)
  })

  it('새벽 2시에 만든 습관은 전날부터 센다', () => {
    const def = makeDef({ createdAt: '2026-03-12T02:00:00+09:00' })
    const stat = only(
      habitStats(snap({ definitions: [def] }), rangeFor('week', TODAY), opts(NOW)),
    )

    expect(stat.targetDays).toBe(2)
  })

  it('만들기 전 날짜에 소급 입력한 기록이 있으면 그날부터 센다', () => {
    const def = makeDef({ createdAt: '2026-03-10T12:00:00+09:00' })
    const snapshot = snap({
      definitions: [def],
      records: dailyRecords(def.id, ['2026-03-08', '2026-03-09']),
    })
    const stat = only(habitStats(snapshot, rangeFor('month', TODAY), opts(NOW)))

    expect(stat.targetDays).toBe(5)
    expect(stat.achievedDays).toBe(2)
  })

  it('삭제된 소급 기록은 분모를 늘리지 않는다', () => {
    const def = makeDef({ createdAt: '2026-03-10T12:00:00+09:00' })
    const snapshot = snap({
      definitions: [def],
      records: dailyRecords(def.id, ['2026-03-08']).map((r) => ({ ...r, deleted: true })),
    })
    const stat = only(habitStats(snapshot, rangeFor('month', TODAY), opts(NOW)))

    expect(stat.targetDays).toBe(3)
    expect(stat.achievedDays).toBe(0)
  })
})

describe('habitStats — 보관해도 지나간 집계는 그대로다', () => {
  function february() {
    const def = makeDef({ name: '아침 약', createdAt: '2026-02-01T09:00:00+09:00' })
    return {
      def,
      records: dailyRecords(def.id, ['2026-02-03', '2026-02-04', '2026-02-05']),
      range: rangeFor('month', '2026-02-10'),
    }
  }

  it('지난달 달성률이 보관 뒤에도 같다', () => {
    const { def, records, range } = february()
    const before = only(habitStats(snap({ definitions: [def], records }), range, opts(NOW)))
    const after = only(
      habitStats(snap({ definitions: [{ ...def, archived: true }], records }), range, opts(NOW)),
    )

    expect(before.targetDays).toBe(28)
    expect(before.achievedDays).toBe(3)
    expect(after.targetDays).toBe(before.targetDays)
    expect(after.achievedDays).toBe(before.achievedDays)
    expect(after.percent).toBe(before.percent)
  })

  it('요약 합계도 보관 때문에 줄지 않는다', () => {
    const { def, records, range } = february()
    const before = summaryFor(habitStats(snap({ definitions: [def], records }), range, opts(NOW)))
    const after = summaryFor(
      habitStats(snap({ definitions: [{ ...def, archived: true }], records }), range, opts(NOW)),
    )

    expect(after).toEqual(before)
    expect(after.totalTargetDays).toBe(28)
    expect(after.totalAchievedDays).toBe(3)
  })

  it('보관한 습관은 definition.archived로 구분된다', () => {
    const { def, records, range } = february()
    const stat = only(
      habitStats(snap({ definitions: [{ ...def, archived: true }], records }), range, opts(NOW)),
    )

    expect(stat.definition.archived).toBe(true)
    expect(stat.definition.name).toBe('아침 약')
  })

  it('그 기간에 대상일이 없던 보관 습관은 목록에 없다', () => {
    const def = makeDef({
      name: '옛 습관',
      archived: true,
      createdAt: '2026-03-05T09:00:00+09:00',
    })
    const stats = habitStats(
      snap({ definitions: [def] }),
      rangeFor('month', '2026-02-10'),
      opts(NOW),
    )

    expect(stats).toEqual([])
  })

  it('보관하지 않은 습관은 대상일이 0이어도 목록에 남는다', () => {
    const def = makeDef({ targetDays: [0] })
    const stats = habitStats(
      snap({ definitions: [def] }),
      { from: '2026-03-09', to: '2026-03-11' },
      opts(NOW),
    )

    expect(stats).toHaveLength(1)
    expect(stats[0]!.targetDays).toBe(0)
  })
})

describe('habitStats — 수량 습관은 그 시점 목표로 판정한다', () => {
  const history = [
    { from: '2026-03-01T00:00:00+09:00', target: 1000 },
    { from: '2026-03-10T09:00:00+09:00', target: 2000 },
  ]

  function withHistory() {
    const def = makeQuantityDef(history)
    return {
      def,
      snapshot: snap({
        definitions: [def],
        records: [
          ...dailyRecords(
            def.id,
            ['2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09'],
            1500,
          ),
          ...dailyRecords(def.id, ['2026-03-10', '2026-03-11', '2026-03-12'], 1500),
        ],
      }),
    }
  }

  it('목표를 올려도 과거 달성이 뒤집히지 않는다', () => {
    const stat = only(
      habitStats(withHistory().snapshot, rangeFor('month', TODAY), opts(NOW)),
    )

    expect(stat.targetDays).toBe(12)
    expect(stat.achievedDays).toBe(5)
  })

  it('목표를 올린 뒤에는 같은 양이 미달성이 된다', () => {
    const stat = only(
      habitStats(
        withHistory().snapshot,
        { from: '2026-03-10', to: '2026-03-12' },
        opts(NOW),
      ),
    )

    expect(stat.achievedDays).toBe(0)
  })

  it('같은 날 합계가 목표를 넘으면 달성이다', () => {
    const def = makeQuantityDef([{ from: '2026-03-01T00:00:00+09:00', target: 2000 }])
    const snapshot = snap({
      definitions: [def],
      records: [
        makeRecord(def.id, '2026-03-11T09:00:00+09:00', 900),
        makeRecord(def.id, '2026-03-11T21:00:00+09:00', 1100),
      ],
    })
    const stat = only(
      habitStats(snapshot, { from: '2026-03-11', to: '2026-03-11' }, opts(NOW)),
    )

    expect(stat.achievedDays).toBe(1)
  })
})

describe('habitStats — 빠지는 것들', () => {
  it('삭제된 기록은 집계에서 빠진다', () => {
    const def = makeDef()
    const records = dailyRecords(def.id, ['2026-03-10', '2026-03-11', '2026-03-12'])
    const range = rangeFor('week', TODAY)

    expect(only(habitStats(snap({ definitions: [def], records }), range, opts(NOW))).achievedDays).toBe(3)

    const pruned = records.map((r) =>
      r.at.startsWith('2026-03-11') ? { ...r, deleted: true } : r,
    )
    expect(
      only(habitStats(snap({ definitions: [def], records: pruned }), range, opts(NOW)))
        .achievedDays,
    ).toBe(2)
  })

  it('삭제된 definition은 아예 나오지 않는다', () => {
    const def = makeDef({ deleted: true })
    const snapshot = snap({
      definitions: [def],
      records: dailyRecords(def.id, ['2026-03-11', '2026-03-12']),
    })

    expect(habitStats(snapshot, rangeFor('week', TODAY), opts(NOW))).toEqual([])
  })

  it('hidden definition은 습관 목록에 없다 — 책 전용 정의가 여기 섞이지 않는다', () => {
    const habit = makeDef({ name: '아침 약' })
    const bookDef = makeDef({ name: '토지 독서', hidden: true })
    const snapshot = snap({ definitions: [habit, bookDef] })
    const stats = habitStats(snapshot, rangeFor('week', TODAY), opts(NOW))

    expect(stats.map((s) => s.definition.name)).toEqual(['아침 약'])
  })

  it('archived definition은 그 기간에 대상일이 있었으면 남는다', () => {
    const snapshot = snap({
      definitions: [makeDef({ name: '아침 약' }), makeDef({ name: '옛 습관', archived: true })],
    })
    const stats = habitStats(snapshot, rangeFor('week', TODAY), opts(NOW))

    expect(stats.map((s) => s.definition.name)).toEqual(['아침 약', '옛 습관'])
    expect(stats.map((s) => s.definition.archived)).toEqual([false, true])
    expect(stats.map((s) => s.targetDays)).toEqual([4, 4])
  })

  it('다른 definition의 기록은 섞이지 않는다', () => {
    const a = makeDef({ name: '아침 약', order: 0 })
    const b = makeDef({ name: '저녁 약', order: 1 })
    const snapshot = snap({
      definitions: [a, b],
      records: dailyRecords(a.id, ['2026-03-11', '2026-03-12']),
    })
    const stats = habitStats(snapshot, rangeFor('week', TODAY), opts(NOW))

    expect(stats[0]!.achievedDays).toBe(2)
    expect(stats[1]!.achievedDays).toBe(0)
  })
})

describe('longestStreakIn', () => {
  it('대상 요일이 아닌 날은 건너뛰고 이어진다', () => {
    const def = makeDef({ targetDays: [1, 3, 5] })
    const records = dailyRecords(def.id, [
      '2026-03-02',
      '2026-03-04',
      '2026-03-06',
      '2026-03-09',
      '2026-03-11',
    ])

    expect(longestStreakIn(def, records, rangeFor('month', TODAY), BOUNDARY)).toBe(5)
  })

  it('대상 요일을 빠뜨리면 거기서 끊기고 가장 긴 구간만 남는다', () => {
    const def = makeDef({ targetDays: [1, 3, 5] })
    const records = dailyRecords(def.id, [
      '2026-03-02',
      '2026-03-04',
      '2026-03-06',
      '2026-03-11',
      '2026-03-13',
    ])

    expect(longestStreakIn(def, records, rangeFor('month', TODAY), BOUNDARY)).toBe(3)
  })

  it('기간 밖의 달성은 세지 않는다', () => {
    const def = makeDef()
    const records = dailyRecords(def.id, [
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ])

    expect(longestStreakIn(def, records, rangeFor('week', TODAY), BOUNDARY)).toBe(1)
  })

  it('기록이 없으면 0이다', () => {
    expect(longestStreakIn(makeDef(), [], rangeFor('week', TODAY), BOUNDARY)).toBe(0)
  })

  it('삭제된 기록은 스트릭을 끊는다', () => {
    const def = makeDef()
    const records = dailyRecords(def.id, ['2026-03-09', '2026-03-10', '2026-03-11'])
    const range = rangeFor('week', TODAY)

    expect(longestStreakIn(def, records, range, BOUNDARY)).toBe(3)

    const pruned = records.map((r) =>
      r.at.startsWith('2026-03-10') ? { ...r, deleted: true } : r,
    )
    expect(longestStreakIn(def, pruned, range, BOUNDARY)).toBe(1)
  })
})

describe('currentStreak', () => {
  it('오늘 기준 연속 달성일을 그대로 들고 온다', () => {
    const def = makeDef()
    const snapshot = snap({
      definitions: [def],
      records: dailyRecords(def.id, ['2026-03-10', '2026-03-11', '2026-03-12']),
    })
    const stat = only(habitStats(snapshot, rangeFor('week', TODAY), opts(NOW)))

    expect(stat.currentStreak).toBe(3)
  })

  it('오늘이 비어도 어제까지의 스트릭은 살아 있다', () => {
    const def = makeDef()
    const snapshot = snap({
      definitions: [def],
      records: dailyRecords(def.id, ['2026-03-10', '2026-03-11']),
    })
    const stat = only(habitStats(snapshot, rangeFor('week', TODAY), opts(NOW)))

    expect(stat.currentStreak).toBe(2)
  })
})

describe('summaryFor', () => {
  const stat = (targetDays: number, achievedDays: number, longestStreak: number): HabitStat => ({
    definition: makeDef(),
    targetDays,
    achievedDays,
    percent: targetDays > 0 ? (achievedDays / targetDays) * 100 : 0,
    longestStreak,
    currentStreak: 0,
  })

  it('습관별 대상 일수로 가중해서 전체 달성률을 낸다', () => {
    const summary = summaryFor([stat(10, 5, 3), stat(2, 2, 2)])

    expect(summary.totalTargetDays).toBe(12)
    expect(summary.totalAchievedDays).toBe(7)
    expect(summary.achievedPercent).toBeCloseTo(58.333, 3)
  })

  it('최장 스트릭은 습관들 가운데 가장 큰 값이다', () => {
    expect(summaryFor([stat(10, 5, 3), stat(2, 2, 7)]).longestStreak).toBe(7)
  })

  it('습관이 하나도 없으면 달성률이 0이다', () => {
    const summary = summaryFor([])

    expect(Number.isNaN(summary.achievedPercent)).toBe(false)
    expect(summary).toEqual({
      achievedPercent: 0,
      longestStreak: 0,
      totalTargetDays: 0,
      totalAchievedDays: 0,
    })
  })
})

describe('journalStats', () => {
  const range = rangeFor('week', TODAY)

  it('같은 날 일기 두 건은 하루로 센다', () => {
    const snapshot = snap({
      journal: [
        makeJournal({ at: '2026-03-11T09:00:00+09:00' }),
        makeJournal({ at: '2026-03-11T22:00:00+09:00' }),
      ],
    })
    const stat = journalStats(snapshot, range, BOUNDARY)

    expect(stat.diaryDays).toBe(1)
    expect(stat.entries).toBe(2)
  })

  it('종류별로 건수를 나눈다 — 일기 쓴 날에는 일기만 센다', () => {
    const snapshot = snap({
      journal: [
        makeJournal({ at: '2026-03-10T09:00:00+09:00' }),
        makeJournal({ kind: 'meeting', at: '2026-03-11T09:00:00+09:00' }),
        makeJournal({ kind: 'memo', at: '2026-03-11T10:00:00+09:00' }),
      ],
    })
    const stat = journalStats(snapshot, range, BOUNDARY)

    expect(stat.byKind).toEqual({ diary: 1, meeting: 1, memo: 1 })
    expect(stat.entries).toBe(3)
    expect(stat.diaryDays).toBe(1)
  })

  it('기간 밖의 일기는 빠진다', () => {
    const snapshot = snap({
      journal: [
        makeJournal({ at: '2026-03-08T09:00:00+09:00' }),
        makeJournal({ at: '2026-03-11T09:00:00+09:00' }),
      ],
    })

    expect(journalStats(snapshot, range, BOUNDARY).entries).toBe(1)
  })

  it('삭제된 일기는 빠진다', () => {
    const snapshot = snap({
      journal: [makeJournal({ at: '2026-03-11T09:00:00+09:00', deleted: true })],
    })
    const stat = journalStats(snapshot, range, BOUNDARY)

    expect(stat.entries).toBe(0)
    expect(stat.diaryDays).toBe(0)
  })
})

describe('readingStats', () => {
  const range = rangeFor('week', TODAY)

  function library() {
    const tojiDef = makeDef({ name: '토지 독서', hidden: true })
    const demianDef = makeDef({ name: '데미안 독서', hidden: true })
    const toji = makeBook({ defId: tojiDef.id, title: '토지' })
    const demian = makeBook({ defId: demianDef.id, title: '데미안' })
    return { tojiDef, demianDef, toji, demian }
  }

  it('기간 안 기록의 value 합계가 읽은 페이지다', () => {
    const { tojiDef, toji } = library()
    const snapshot = snap({
      definitions: [tojiDef],
      books: [toji],
      records: [
        makeRecord(tojiDef.id, '2026-03-10T21:00:00+09:00', 30),
        makeRecord(tojiDef.id, '2026-03-11T21:00:00+09:00', 20),
      ],
    })
    const stat = readingStats(snapshot, range, BOUNDARY)

    expect(stat.pagesRead).toBe(50)
    expect(stat.sessions).toBe(2)
  })

  it('기간 밖 기록은 빠진다', () => {
    const { tojiDef, toji } = library()
    const snapshot = snap({
      definitions: [tojiDef],
      books: [toji],
      records: [
        makeRecord(tojiDef.id, '2026-03-05T21:00:00+09:00', 100),
        makeRecord(tojiDef.id, '2026-03-10T21:00:00+09:00', 30),
      ],
    })
    const stat = readingStats(snapshot, range, BOUNDARY)

    expect(stat.pagesRead).toBe(30)
    expect(stat.sessions).toBe(1)
  })

  it('책별 내역을 많이 읽은 순으로 준다', () => {
    const { tojiDef, demianDef, toji, demian } = library()
    const snapshot = snap({
      definitions: [tojiDef, demianDef],
      books: [toji, demian],
      records: [
        makeRecord(demianDef.id, '2026-03-10T21:00:00+09:00', 15),
        makeRecord(tojiDef.id, '2026-03-11T21:00:00+09:00', 60),
      ],
    })
    const stat = readingStats(snapshot, range, BOUNDARY)

    expect(stat.pagesRead).toBe(75)
    expect(stat.byBook.map((b) => [b.book.title, b.pages])).toEqual([
      ['토지', 60],
      ['데미안', 15],
    ])
  })

  it('완독은 finishedAt이 기간 안에 든 책만 센다', () => {
    const { tojiDef, demianDef, toji, demian } = library()
    const snapshot = snap({
      definitions: [tojiDef, demianDef],
      books: [
        { ...toji, status: 'finished', finishedAt: '2026-03-11T22:00:00+09:00' },
        { ...demian, status: 'finished', finishedAt: '2026-02-20T22:00:00+09:00' },
      ],
    })

    expect(readingStats(snapshot, range, BOUNDARY).finishedBooks).toBe(1)
  })

  it('삭제된 기록과 삭제된 책은 빠진다', () => {
    const { tojiDef, demianDef, toji, demian } = library()
    const snapshot = snap({
      definitions: [tojiDef, demianDef],
      books: [toji, { ...demian, deleted: true }],
      records: [
        makeRecord(tojiDef.id, '2026-03-10T21:00:00+09:00', 30),
        { ...makeRecord(tojiDef.id, '2026-03-11T21:00:00+09:00', 20), deleted: true },
        makeRecord(demianDef.id, '2026-03-11T21:00:00+09:00', 99),
      ],
    })
    const stat = readingStats(snapshot, range, BOUNDARY)

    expect(stat.pagesRead).toBe(30)
    expect(stat.sessions).toBe(1)
    expect(stat.byBook).toHaveLength(1)
  })

  it('삭제된 definition에 붙은 책은 빠진다', () => {
    const { tojiDef, toji } = library()
    const snapshot = snap({
      definitions: [{ ...tojiDef, deleted: true }],
      books: [toji],
      records: [makeRecord(tojiDef.id, '2026-03-10T21:00:00+09:00', 30)],
    })

    expect(readingStats(snapshot, range, BOUNDARY).pagesRead).toBe(0)
  })

  it('책과 이어지지 않은 기록은 페이지로 세지 않는다', () => {
    const habit = makeDef({ name: '아침 약' })
    const snapshot = snap({
      definitions: [habit],
      records: dailyRecords(habit.id, ['2026-03-10', '2026-03-11']),
    })

    expect(readingStats(snapshot, range, BOUNDARY).pagesRead).toBe(0)
  })
})

describe('통계 화면', () => {
  function loaded() {
    const def = makeDef({ name: '아침 약' })
    return snap({
      definitions: [def],
      records: dailyRecords(def.id, [
        '2026-03-09',
        '2026-03-10',
        '2026-03-11',
        '2026-03-12',
      ]),
      journal: [makeJournal({ at: '2026-03-11T09:00:00+09:00' })],
    })
  }

  it('기간 토글을 바꾸면 숫자가 바뀐다', async () => {
    const user = userEvent.setup()
    mount(loaded())

    expect(await screen.findByText('4/4일')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '월' }))
    expect(await screen.findByText('4/12일')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '주' }))
    expect(await screen.findByText('4/4일')).toBeTruthy()
  })

  it('고른 기간이 눌린 상태로 표시된다', async () => {
    const user = userEvent.setup()
    mount(loaded())

    const week = await screen.findByRole('button', { name: '주' })
    expect(week.getAttribute('aria-pressed')).toBe('true')

    await user.click(screen.getByRole('button', { name: '연' }))
    expect(screen.getByRole('button', { name: '연' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '주' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('2026-01-01 ~ 2026-12-31')).toBeTruthy()
  })

  it('요약 카드가 달성률과 최장 스트릭을 보여준다', async () => {
    mount(loaded())

    const rate = (await screen.findByText('기간 달성률')).closest('.card')!
    expect(within(rate as HTMLElement).getByText('100%')).toBeTruthy()

    const streak = screen.getByText('최장 스트릭').closest('.card')!
    expect(within(streak as HTMLElement).getByText('4일')).toBeTruthy()
  })

  it('독서와 일기 집계를 함께 보여준다', async () => {
    const bookDef = makeDef({ name: '토지 독서', hidden: true })
    const book = makeBook({ defId: bookDef.id, title: '토지' })
    mount(
      snap({
        definitions: [bookDef],
        books: [{ ...book, status: 'finished', finishedAt: '2026-03-11T22:00:00+09:00' }],
        records: [makeRecord(bookDef.id, '2026-03-10T21:00:00+09:00', 42)],
        journal: [makeJournal({ at: '2026-03-11T09:00:00+09:00' })],
      }),
    )

    const facts = (await screen.findByText('읽은 페이지')).closest('.stat-facts')!
    expect(within(facts as HTMLElement).getByText('42쪽')).toBeTruthy()
    expect(within(facts as HTMLElement).getByText('1권')).toBeTruthy()
    expect(within(facts as HTMLElement).getByText('1일')).toBeTruthy()

    const books = screen.getByText('토지').closest('.stat-books')!
    expect(within(books as HTMLElement).getByText('42쪽')).toBeTruthy()
  })

  it('책 전용 정의는 습관 막대로 올라오지 않는다', async () => {
    const bookDef = makeDef({ name: '토지 독서', hidden: true })
    mount(
      snap({
        definitions: [bookDef],
        books: [makeBook({ defId: bookDef.id, title: '토지' })],
        records: [makeRecord(bookDef.id, '2026-03-10T21:00:00+09:00', 42)],
      }),
    )

    expect(await screen.findByText('토지')).toBeTruthy()
    expect(screen.queryByText('토지 독서')).toBeNull()
  })

  it('데이터가 없으면 안내 문구를 보여준다', async () => {
    mount(snap())

    expect(await screen.findByText(/표시할 습관이 없습니다/)).toBeTruthy()
    expect(screen.getByText('이 기간에 남긴 기록이 없습니다.')).toBeTruthy()
    expect(screen.getByText('0%')).toBeTruthy()
  })

  it('보관한 습관은 보관으로 구분해 보여준다', async () => {
    mount(
      snap({
        definitions: [
          makeDef({ name: '아침 약', order: 0 }),
          makeDef({ name: '옛 습관', order: 1, archived: true }),
        ],
      }),
    )

    const kept = (await screen.findByText('아침 약')).closest('.stat-bar')!
    const filed = screen.getByText('옛 습관').closest('.stat-bar')!

    expect(within(filed as HTMLElement).getByText('보관')).toBeTruthy()
    expect(within(kept as HTMLElement).queryByText('보관')).toBeNull()
  })

  it('보관한 습관은 막대 설명에도 보관이라고 적힌다', async () => {
    mount(snap({ definitions: [makeDef({ name: '옛 습관', archived: true })] }))

    expect(await screen.findByLabelText('옛 습관 보관 0퍼센트')).toBeTruthy()
  })
})

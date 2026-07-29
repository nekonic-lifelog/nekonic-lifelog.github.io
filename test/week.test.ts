// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fc from 'fast-check'
import type { RowTypes, Snapshot, Store, TableName } from '../src/data/store'
import { fixedClock } from '../src/lib/clock'
import { addDays, daysBetween } from '../src/lib/day'
import { toDueAt } from '../src/lib/due'
import { WEEK_LENGTH, shiftWeek, weekDays, weekStart } from '../src/lib/week'
import { DEFAULT_SETTINGS } from '../src/lib/types'
import { AppProvider, mergeById } from '../src/state/app'
import { Today } from '../src/screens/Today'
import { WeekStrip } from '../src/ui/WeekStrip'
import { makeTodo, resetIds } from './factories'

const NOW = '2026-03-12T20:00:00+09:00'
const TODAY = '2026-03-12'
const MONDAY = '2026-03-09'
const SUNDAY = '2026-03-15'
const HOUR = 4

function snap(patch: Partial<Snapshot> = {}): Snapshot {
  return {
    definitions: [],
    records: [],
    todos: [],
    projects: [],
    books: [],
    journal: [],
    settings: DEFAULT_SETTINGS,
    ...patch,
  }
}

function memoryStore(initial: Partial<Snapshot> = {}): Store {
  const data = snap(initial)
  return {
    async deviceId() {
      return 'test-device'
    },
    async adoptDeviceId() {
      return undefined
    },
    async loadAll() {
      return { ...data }
    },
    async put<K extends TableName>(table: K, rows: RowTypes[K][]) {
      const merged = mergeById(data[table] as { id: string }[], rows)
      ;(data as unknown as Record<string, unknown>)[table] = merged
    },
    async putSettings(settings) {
      data.settings = settings
    },
    async replaceAll(next) {
      Object.assign(data, next)
    },
  }
}

function days(anchor: string, patch: Partial<Snapshot> = {}, selected = TODAY) {
  return weekDays(anchor, TODAY, selected, snap(patch), HOUR)
}

function mountStrip(
  props: { selected: string; today: string; onSelect(day: string): void },
  initial: Partial<Snapshot> = {},
) {
  return render(
    createElement(AppProvider, {
      store: memoryStore(initial),
      clock: fixedClock(NOW),
      children: createElement(WeekStrip, props),
    }),
  )
}

function mountToday(initial: Partial<Snapshot> = {}) {
  return render(
    createElement(AppProvider, {
      store: memoryStore(initial),
      clock: fixedClock(NOW),
      children: createElement(Today),
    }),
  )
}

beforeEach(resetIds)
afterEach(cleanup)

describe('주의 시작', () => {
  it('아무 날이나 넣으면 그 주 월요일을 준다', () => {
    expect(weekStart(TODAY)).toBe(MONDAY)
    expect(weekStart(SUNDAY)).toBe(MONDAY)
  })

  it('월요일을 넣으면 그대로 둔다', () => {
    expect(weekStart(MONDAY)).toBe(MONDAY)
  })

  it('일요일 시작을 고르면 하루 앞선 일요일이 나온다', () => {
    expect(weekStart(TODAY, 0)).toBe('2026-03-08')
    expect(weekStart('2026-03-08', 0)).toBe('2026-03-08')
    expect(weekStart(SUNDAY, 0)).toBe(SUNDAY)
  })

  it('어느 날을 넣어도 시작일은 6일 안쪽 과거이고 시작일 자신은 움직이지 않는다', () => {
    fc.assert(
      fc.property(fc.integer({ min: -800, max: 800 }), (delta) => {
        const day = addDays(TODAY, delta)
        const start = weekStart(day)
        const gap = daysBetween(day, start)
        return gap >= 0 && gap < WEEK_LENGTH && weekStart(start) === start
      }),
    )
  })
})

describe('한 주 펼치기', () => {
  it('월요일부터 일요일까지 이레를 준다', () => {
    const week = days(TODAY)
    expect(week).toHaveLength(7)
    expect(week.map((d) => d.day)).toEqual([
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
      '2026-03-12',
      '2026-03-13',
      '2026-03-14',
      SUNDAY,
    ])
    expect(week.map((d) => d.label)).toEqual(['월', '화', '수', '목', '금', '토', '일'])
    expect(week.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0])
  })

  it('달을 넘어가도 이레다', () => {
    const week = days('2026-03-31')
    expect(week).toHaveLength(7)
    expect(week[0]?.day).toBe('2026-03-30')
    expect(week[6]?.day).toBe('2026-04-05')
    expect(week.map((d) => d.dayOfMonth)).toEqual([30, 31, 1, 2, 3, 4, 5])
  })

  it('해를 넘어가도 이레다', () => {
    const week = days('2026-12-31')
    expect(week).toHaveLength(7)
    expect(week[0]?.day).toBe('2026-12-28')
    expect(week[6]?.day).toBe('2027-01-03')
  })

  it('윤달 29일이 든 주도 이레다', () => {
    const week = weekDays('2024-02-29', '2024-02-29', '2024-02-29', snap(), HOUR)
    expect(week).toHaveLength(7)
    expect(week.map((d) => d.day)).toContain('2024-02-29')
    expect(week[0]?.day).toBe('2024-02-26')
    expect(week[6]?.day).toBe('2024-03-03')
  })

  it('어느 날을 기준으로 잡아도 이레가 하루씩 이어진다', () => {
    fc.assert(
      fc.property(fc.integer({ min: -800, max: 800 }), (delta) => {
        const week = days(addDays(TODAY, delta))
        if (week.length !== WEEK_LENGTH) return false
        return week.every((d, i) => i === 0 || d.day === addDays(week[i - 1]!.day, 1))
      }),
    )
  })

  it('일요일 시작을 고르면 일요일이 맨 앞에 온다', () => {
    const week = weekDays(TODAY, TODAY, TODAY, snap(), HOUR, 0)
    expect(week).toHaveLength(7)
    expect(week[0]?.day).toBe('2026-03-08')
    expect(week.map((d) => d.label)).toEqual(['일', '월', '화', '수', '목', '금', '토'])
  })
})

describe('할 일 세기', () => {
  it('그날 마감인 미완료만 todoCount에 든다', () => {
    const week = days(TODAY, {
      todos: [
        makeTodo({ id: 'a', dueAt: toDueAt('2026-03-11', '10:00') }),
        makeTodo({ id: 'b', dueAt: toDueAt('2026-03-11', '17:00') }),
        makeTodo({ id: 'c', dueAt: toDueAt('2026-03-13', '10:00') }),
      ],
    })
    const byDay = new Map(week.map((d) => [d.day, d]))
    expect(byDay.get('2026-03-11')?.todoCount).toBe(2)
    expect(byDay.get('2026-03-13')?.todoCount).toBe(1)
    expect(byDay.get(TODAY)?.todoCount).toBe(0)
  })

  it('완료한 것은 doneCount로 따로 센다', () => {
    const week = days(TODAY, {
      todos: [
        makeTodo({ id: 'a', dueAt: toDueAt(TODAY, '10:00') }),
        makeTodo({ id: 'b', dueAt: toDueAt(TODAY, '11:00'), status: 'done' }),
        makeTodo({ id: 'c', dueAt: toDueAt(TODAY, '12:00'), status: 'done' }),
      ],
    })
    const today = week.find((d) => d.day === TODAY)
    expect(today?.todoCount).toBe(1)
    expect(today?.doneCount).toBe(2)
  })

  it('지운 할 일은 어느 쪽으로도 세지 않는다', () => {
    const week = days(TODAY, {
      todos: [
        makeTodo({ id: 'a', dueAt: toDueAt(TODAY, '10:00'), deleted: true }),
        makeTodo({ id: 'b', dueAt: toDueAt(TODAY, '11:00'), status: 'done', deleted: true }),
      ],
    })
    const today = week.find((d) => d.day === TODAY)
    expect(today?.todoCount).toBe(0)
    expect(today?.doneCount).toBe(0)
  })

  it('마감이 없는 할 일은 어느 날에도 세지 않는다', () => {
    const week = days(TODAY, { todos: [makeTodo({ id: 'a', title: '언젠가' })] })
    expect(week.map((d) => d.todoCount)).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(week.map((d) => d.doneCount)).toEqual([0, 0, 0, 0, 0, 0, 0])
  })

  it('하루 경계가 오전 4시라 새벽 2시 마감은 전날로 센다', () => {
    const dawn = { todos: [makeTodo({ id: 'a', dueAt: toDueAt('2026-03-13', '02:00') })] }
    const week = days(TODAY, dawn)
    const byDay = new Map(week.map((d) => [d.day, d]))
    expect(byDay.get(TODAY)?.todoCount).toBe(1)
    expect(byDay.get('2026-03-13')?.todoCount).toBe(0)
  })

  it('경계를 0시로 두면 같은 마감이 다음 날로 넘어간다', () => {
    const todos = [makeTodo({ id: 'a', dueAt: toDueAt('2026-03-13', '02:00') })]
    const week = weekDays(TODAY, TODAY, TODAY, snap({ todos }), 0)
    const byDay = new Map(week.map((d) => [d.day, d]))
    expect(byDay.get(TODAY)?.todoCount).toBe(0)
    expect(byDay.get('2026-03-13')?.todoCount).toBe(1)
  })
})

describe('밀린 날 표시', () => {
  it('지난 날에 미완료가 남아 있으면 밀렸다고 본다', () => {
    const week = days(TODAY, {
      todos: [makeTodo({ id: 'a', dueAt: toDueAt('2026-03-10', '10:00') })],
    })
    expect(week.find((d) => d.day === '2026-03-10')?.hasOverdue).toBe(true)
  })

  it('오늘과 앞으로 올 날은 미완료가 있어도 밀린 것이 아니다', () => {
    const week = days(TODAY, {
      todos: [
        makeTodo({ id: 'a', dueAt: toDueAt(TODAY, '10:00') }),
        makeTodo({ id: 'b', dueAt: toDueAt('2026-03-14', '10:00') }),
      ],
    })
    expect(week.find((d) => d.day === TODAY)?.hasOverdue).toBe(false)
    expect(week.find((d) => d.day === '2026-03-14')?.hasOverdue).toBe(false)
  })

  it('지난 날이라도 다 끝냈으면 밀린 것이 아니다', () => {
    const week = days(TODAY, {
      todos: [makeTodo({ id: 'a', dueAt: toDueAt('2026-03-10', '10:00'), status: 'done' })],
    })
    const past = week.find((d) => d.day === '2026-03-10')
    expect(past?.hasOverdue).toBe(false)
    expect(past?.doneCount).toBe(1)
  })

  it('할 일이 없는 지난 날도 밀린 것이 아니다', () => {
    expect(days(TODAY).find((d) => d.day === MONDAY)?.hasOverdue).toBe(false)
  })
})

describe('오늘과 고른 날', () => {
  it('오늘 한 칸만 오늘이고 고른 날 한 칸만 골라져 있다', () => {
    const week = days(TODAY, {}, '2026-03-10')
    expect(week.filter((d) => d.isToday).map((d) => d.day)).toEqual([TODAY])
    expect(week.filter((d) => d.isSelected).map((d) => d.day)).toEqual(['2026-03-10'])
  })

  it('오늘을 고르면 한 칸이 둘 다 참이 된다', () => {
    const today = days(TODAY).find((d) => d.day === TODAY)
    expect(today?.isToday).toBe(true)
    expect(today?.isSelected).toBe(true)
  })

  it('지난 주를 펼치면 오늘 칸이 하나도 없다', () => {
    const week = days('2026-03-02', {}, '2026-03-02')
    expect(week.some((d) => d.isToday)).toBe(false)
    expect(week.filter((d) => d.isSelected)).toHaveLength(1)
  })
})

describe('주 넘기기', () => {
  it('한 번에 이레씩 움직인다', () => {
    expect(shiftWeek(TODAY, 1)).toBe('2026-03-19')
    expect(shiftWeek(TODAY, -1)).toBe('2026-03-05')
    expect(shiftWeek(TODAY, 0)).toBe(TODAY)
    expect(shiftWeek(TODAY, 3)).toBe('2026-04-02')
  })

  it('넘긴 뒤에도 같은 요일에 머문다', () => {
    fc.assert(
      fc.property(fc.integer({ min: -60, max: 60 }), (delta) => {
        const moved = shiftWeek(TODAY, delta)
        return daysBetween(moved, TODAY) === delta * WEEK_LENGTH
      }),
    )
  })
})

describe('주간 띠 화면', () => {
  it('칸마다 날짜와 요일과 건수를 문장으로 읽어 준다', async () => {
    mountStrip(
      { selected: TODAY, today: TODAY, onSelect: () => undefined },
      {
        todos: [
          makeTodo({ id: 'a', dueAt: toDueAt(TODAY, '09:00') }),
          makeTodo({ id: 'b', dueAt: toDueAt(TODAY, '10:00') }),
          makeTodo({ id: 'c', dueAt: toDueAt(TODAY, '11:00') }),
        ],
      },
    )

    expect(await screen.findByLabelText('3월 12일 목요일, 오늘, 할 일 3건')).toBeTruthy()
    expect(screen.getByLabelText('3월 9일 월요일, 할 일 없음')).toBeTruthy()
  })

  it('완료한 건수와 밀린 사실도 문장에 넣는다', async () => {
    mountStrip(
      { selected: TODAY, today: TODAY, onSelect: () => undefined },
      {
        todos: [
          makeTodo({ id: 'a', dueAt: toDueAt('2026-03-10', '09:00') }),
          makeTodo({ id: 'b', dueAt: toDueAt('2026-03-10', '10:00'), status: 'done' }),
        ],
      },
    )

    expect(
      await screen.findByLabelText('3월 10일 화요일, 할 일 1건, 완료 1건, 기한 지남'),
    ).toBeTruthy()
  })

  it('고른 칸만 눌린 상태로 표시한다', async () => {
    mountStrip({ selected: '2026-03-10', today: TODAY, onSelect: () => undefined })

    const picked = await screen.findByLabelText(/3월 10일 화요일/)
    expect(picked.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText(/3월 12일 목요일, 오늘/).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('칸을 누르면 그 날짜로 알려 준다', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    mountStrip({ selected: TODAY, today: TODAY, onSelect })

    await user.click(await screen.findByLabelText(/3월 14일 토요일/))
    expect(onSelect).toHaveBeenCalledWith('2026-03-14')
  })

  it('지난 주로 넘기면 그 주가 보이고 되돌아갈 길이 생긴다', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    mountStrip({ selected: TODAY, today: TODAY, onSelect })

    expect(screen.queryByRole('button', { name: '이번 주로' })).toBeNull()
    await user.click(await screen.findByLabelText('지난 주'))

    expect(await screen.findByLabelText(/3월 2일 월요일/)).toBeTruthy()
    expect(screen.queryByLabelText(/3월 12일 목요일/)).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '이번 주로' }))
    expect(await screen.findByLabelText(/3월 12일 목요일/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '이번 주로' })).toBeNull()
  })

  it('다음 주로 넘기면 다음 이레가 보인다', async () => {
    const user = userEvent.setup()
    mountStrip({ selected: TODAY, today: TODAY, onSelect: () => undefined })

    await user.click(await screen.findByLabelText('다음 주'))
    expect(await screen.findByLabelText(/3월 16일 월요일/)).toBeTruthy()
    expect(await screen.findByLabelText(/3월 22일 일요일/)).toBeTruthy()
  })
})

describe('오늘 화면과 이어 붙이기', () => {
  const todos = [
    makeTodo({ id: 'old', title: '지난 일', dueAt: toDueAt(MONDAY, '10:00') }),
    makeTodo({ id: 'yday', title: '어제 일', dueAt: toDueAt('2026-03-11', '10:00') }),
  ]

  it('띠에서 날짜를 누르면 그 날 화면이 뜬다', async () => {
    const user = userEvent.setup()
    mountToday({ todos })

    expect(await screen.findByRole('button', { name: /지난 기한 2건/ })).toBeTruthy()
    expect(screen.queryByText('어제 일')).toBeNull()

    await user.click(screen.getByLabelText(/3월 9일 월요일/))

    await waitFor(() => expect(screen.getByText('지난 일')).toBeTruthy())
    expect(screen.queryByText('어제 일')).toBeNull()
    expect(screen.queryByRole('button', { name: /지난 기한/ })).toBeNull()
    expect(screen.getByText('3월 9일 (월)')).toBeTruthy()
    expect(screen.getByText('이 날까지의 할 일')).toBeTruthy()
  })

  it('지난 기한을 펼치면 그 날까지 밀린 것이 다 보인다', async () => {
    const user = userEvent.setup()
    mountToday({ todos })

    await user.click(await screen.findByRole('button', { name: /지난 기한 2건/ }))

    expect(await screen.findByText('어제 일')).toBeTruthy()
    expect(screen.getByText('지난 일')).toBeTruthy()
  })

  it('좌우 화살표로 옮기면 띠의 선택도 따라 움직인다', async () => {
    const user = userEvent.setup()
    mountToday()

    await user.click(await screen.findByLabelText('이전 날'))

    await waitFor(() =>
      expect(screen.getByLabelText(/3월 11일 수요일/).getAttribute('aria-pressed')).toBe('true'),
    )
    expect(screen.getByLabelText(/3월 12일 목요일, 오늘/).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('화살표로 이번 주 밖까지 나가면 띠도 그 주를 보여준다', async () => {
    const user = userEvent.setup()
    mountToday()

    const back = await screen.findByLabelText('이전 날')
    for (let i = 0; i < 5; i++) await user.click(back)

    await waitFor(() =>
      expect(screen.getByLabelText(/3월 7일 토요일/).getAttribute('aria-pressed')).toBe('true'),
    )
    expect(screen.getByLabelText(/3월 2일 월요일/)).toBeTruthy()
    expect(screen.queryByLabelText(/3월 12일 목요일/)).toBeNull()
  })

  it('오늘로 돌아가는 길과 화살표 이름은 그대로다', async () => {
    const user = userEvent.setup()
    mountToday()

    expect(await screen.findByLabelText('이전 날')).toBeTruthy()
    expect(screen.getByLabelText('다음 날')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '오늘로 돌아가기' })).toBeNull()

    await user.click(screen.getByLabelText(/3월 10일 화요일/))
    const home = await screen.findByRole('button', { name: '오늘로 돌아가기' })
    await user.click(home)

    await waitFor(() => expect(screen.getByText('오늘')).toBeTruthy())
    expect(screen.getByLabelText(/3월 12일 목요일, 오늘/).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })
})

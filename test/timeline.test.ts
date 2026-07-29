// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fc from 'fast-check'
import type { RowTypes, Snapshot, Store, TableName } from '../src/data/store'
import { fixedClock } from '../src/lib/clock'
import { addDays, daysBetween } from '../src/lib/day'
import { toDueAt } from '../src/lib/due'
import { groupTodosByDue } from '../src/lib/groupTodos'
import {
  TIMELINE_MIN_DAYS,
  TIMELINE_MIN_WIDTH_PERCENT,
  axisTicks,
  barFor,
  projectStartDay,
  timelineBars,
  timelineRange,
  todayPercent,
} from '../src/lib/timeline'
import { DEFAULT_SETTINGS } from '../src/lib/types'
import type { Project } from '../src/lib/types'
import { AppProvider, mergeById } from '../src/state/app'
import { Todos } from '../src/screens/Todos'
import { makeProject, makeTodo, resetIds } from './factories'

const NOW = '2026-03-12T20:00:00+09:00'
const TODAY = '2026-03-12'
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

function mountScreen(initial: Partial<Snapshot> = {}) {
  return render(
    createElement(AppProvider, {
      store: memoryStore(initial),
      clock: fixedClock(NOW),
      children: createElement(Todos),
    }),
  )
}

async function openTimeline(): Promise<void> {
  const user = userEvent.setup()
  const toggle = await screen.findByRole('button', { name: /일정 보기/ })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  await user.click(toggle)
}

function dated(overrides: Partial<Project> = {}): Project {
  return makeProject({
    name: '이사 준비',
    startAt: toDueAt('2026-03-10'),
    dueAt: toDueAt('2026-03-14'),
    ...overrides,
  })
}

function emptyRange(minDays = TIMELINE_MIN_DAYS) {
  return timelineRange([], TODAY, minDays, HOUR)
}

beforeEach(() => {
  resetIds()
  window.location.hash = ''
})
afterEach(cleanup)

describe('시간 범위 잡기', () => {
  it('프로젝트가 없으면 오늘을 품은 minDays짜리 범위를 준다', () => {
    const range = emptyRange()
    expect(range.days).toHaveLength(TIMELINE_MIN_DAYS)
    expect(range.days).toContain(TODAY)
    expect(range.days[0]).toBe(range.from)
    expect(range.days[range.days.length - 1]).toBe(range.to)
  })

  it('마감이 없는 프로젝트만 있어도 minDays짜리 범위를 준다', () => {
    const range = timelineRange([makeProject({ id: 'p1' })], TODAY, TIMELINE_MIN_DAYS, HOUR)
    expect(range.days).toHaveLength(TIMELINE_MIN_DAYS)
    expect(range.days).toContain(TODAY)
  })

  it('minDays를 줄여도 프로젝트 시작과 마감을 앞뒤 여유와 함께 감싼다', () => {
    const range = timelineRange(
      [dated({ startAt: toDueAt('2026-03-10'), dueAt: toDueAt('2026-03-20') })],
      TODAY,
      3,
      HOUR,
    )
    expect(range.from < '2026-03-10').toBe(true)
    expect(range.to > '2026-03-20').toBe(true)
  })

  it('오늘이 프로젝트 바깥에 있어도 범위는 오늘을 포함한다', () => {
    const far = dated({ startAt: toDueAt('2026-06-01'), dueAt: toDueAt('2026-06-10') })
    const range = timelineRange([far], TODAY, TIMELINE_MIN_DAYS, HOUR)
    expect(range.days).toContain(TODAY)
    expect(range.from <= TODAY).toBe(true)
    expect(range.to >= '2026-06-10').toBe(true)
  })

  it('어떤 프로젝트를 넣어도 오늘이 범위에 든다', () => {
    fc.assert(
      fc.property(fc.integer({ min: -900, max: 900 }), fc.integer({ min: 1, max: 90 }), (delta, minDays) => {
        const project = dated({
          startAt: toDueAt(addDays(TODAY, delta)),
          dueAt: toDueAt(addDays(TODAY, delta)),
        })
        const range = timelineRange([project], TODAY, minDays, HOUR)
        return range.from <= TODAY && TODAY <= range.to
      }),
    )
  })
})

describe('바 그리기', () => {
  it('시작과 마감이 있는 프로젝트는 범위 안에 자리를 잡는다', () => {
    const range = timelineRange([dated()], TODAY, TIMELINE_MIN_DAYS, HOUR)
    const bar = barFor(dated(), range, TODAY, HOUR)
    if (!bar) throw new Error('바가 없습니다')

    const total = range.days.length
    expect(bar.startDay).toBe('2026-03-10')
    expect(bar.endDay).toBe('2026-03-14')
    expect(bar.offsetPercent).toBeCloseTo((daysBetween('2026-03-10', range.from) / total) * 100, 2)
    expect(bar.widthPercent).toBeCloseTo((5 / total) * 100, 2)
    expect(bar.clippedStart).toBe(false)
    expect(bar.clippedEnd).toBe(false)
    expect(bar.undated).toBe(false)
  })

  it('마감이 없으면 바가 없다', () => {
    const range = emptyRange()
    expect(barFor(makeProject({ id: 'p1' }), range, TODAY, HOUR)).toBeNull()
  })

  it('마감이 없는 프로젝트는 undated로 잡혀 목록에서 사라지지 않는다', () => {
    const range = emptyRange()
    const bars = timelineBars([makeProject({ id: 'p1', name: '언젠가' })], range, TODAY, HOUR)
    expect(bars).toHaveLength(1)
    expect(bars[0]?.undated).toBe(true)
    expect(bars[0]?.project.name).toBe('언젠가')
  })

  it('startAt이 없으면 createdAt을 시작으로 쓴다', () => {
    const project = makeProject({
      id: 'p1',
      createdAt: '2026-03-05T12:00:00+09:00',
      dueAt: toDueAt('2026-03-14'),
    })
    expect(projectStartDay(project, HOUR)).toBe('2026-03-05')
    const range = timelineRange([project], TODAY, TIMELINE_MIN_DAYS, HOUR)
    expect(barFor(project, range, TODAY, HOUR)?.startDay).toBe('2026-03-05')
  })

  it('startAt이 있으면 createdAt 대신 그것을 쓴다', () => {
    const project = makeProject({
      id: 'p1',
      createdAt: '2026-03-05T12:00:00+09:00',
      startAt: toDueAt('2026-03-08'),
      dueAt: toDueAt('2026-03-14'),
    })
    expect(projectStartDay(project, HOUR)).toBe('2026-03-08')
    const range = timelineRange([project], TODAY, TIMELINE_MIN_DAYS, HOUR)
    expect(barFor(project, range, TODAY, HOUR)?.startDay).toBe('2026-03-08')
  })

  it('범위 밖으로 삐져나가면 잘라 그리고 잘린 사실을 알린다', () => {
    const range = emptyRange()
    const long = dated({ startAt: toDueAt('2026-01-01'), dueAt: toDueAt('2026-12-31') })
    const bar = barFor(long, range, TODAY, HOUR)
    if (!bar) throw new Error('바가 없습니다')

    expect(bar.clippedStart).toBe(true)
    expect(bar.clippedEnd).toBe(true)
    expect(bar.offsetPercent).toBe(0)
    expect(bar.widthPercent).toBe(100)
    expect(bar.startDay).toBe('2026-01-01')
    expect(bar.endDay).toBe('2026-12-31')
  })

  it('한쪽만 삐져나가면 그쪽만 잘렸다고 한다', () => {
    const range = emptyRange()
    const late = dated({ startAt: toDueAt(range.to), dueAt: toDueAt(addDays(range.to, 30)) })
    const bar = barFor(late, range, TODAY, HOUR)
    if (!bar) throw new Error('바가 없습니다')

    expect(bar.clippedStart).toBe(false)
    expect(bar.clippedEnd).toBe(true)
  })

  it('범위와 겹치지 않으면 null이다', () => {
    const range = emptyRange()
    const past = dated({ startAt: toDueAt('2025-01-01'), dueAt: toDueAt('2025-02-01') })
    const future = dated({ startAt: toDueAt('2027-01-01'), dueAt: toDueAt('2027-02-01') })
    expect(barFor(past, range, TODAY, HOUR)).toBeNull()
    expect(barFor(future, range, TODAY, HOUR)).toBeNull()
  })

  it('시작이 마감보다 늦어도 음수 너비가 나오지 않는다', () => {
    const range = emptyRange()
    const twisted = dated({ startAt: toDueAt('2026-03-20'), dueAt: toDueAt('2026-03-14') })
    const bar = barFor(twisted, range, TODAY, HOUR)
    if (!bar) throw new Error('바가 없습니다')

    expect(bar.widthPercent).toBeGreaterThan(0)
    expect(bar.startDay).toBe('2026-03-14')
    expect(bar.endDay).toBe('2026-03-14')
  })

  it('하루짜리 프로젝트도 눈에 보이는 너비를 갖는다', () => {
    const range = emptyRange(120)
    const oneDay = dated({ startAt: toDueAt(TODAY), dueAt: toDueAt(TODAY) })
    const bar = barFor(oneDay, range, TODAY, HOUR)
    expect(bar?.widthPercent).toBeGreaterThanOrEqual(TIMELINE_MIN_WIDTH_PERCENT)
  })

  it('어떤 입력에도 offset과 width가 0~100 안에 머문다', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -400, max: 400 }),
        fc.integer({ min: -400, max: 400 }),
        fc.integer({ min: 1, max: 120 }),
        (startDelta, endDelta, minDays) => {
          const project = dated({
            startAt: toDueAt(addDays(TODAY, startDelta)),
            dueAt: toDueAt(addDays(TODAY, endDelta)),
          })
          const range = emptyRange(minDays)
          const bar = barFor(project, range, TODAY, HOUR)
          if (!bar) return true
          return (
            bar.offsetPercent >= 0 &&
            bar.widthPercent > 0 &&
            bar.widthPercent <= 100 &&
            bar.offsetPercent + bar.widthPercent <= 100
          )
        },
      ),
    )
  })

  it('마감이 지났고 완료가 아니면 overdue다', () => {
    const range = emptyRange()
    const late = dated({ startAt: toDueAt('2026-03-10'), dueAt: toDueAt('2026-03-11') })
    expect(barFor(late, range, TODAY, HOUR)?.overdue).toBe(true)
  })

  it('완료한 프로젝트는 마감이 지나도 overdue가 아니다', () => {
    const range = emptyRange()
    const done = dated({
      status: 'done',
      startAt: toDueAt('2026-03-10'),
      dueAt: toDueAt('2026-03-11'),
    })
    const bar = barFor(done, range, TODAY, HOUR)
    expect(bar?.overdue).toBe(false)
    expect(bar?.project.status).toBe('done')
  })

  it('오늘 마감이면 아직 지나지 않았다', () => {
    const range = emptyRange()
    const today = dated({ startAt: toDueAt('2026-03-10'), dueAt: toDueAt(TODAY) })
    expect(barFor(today, range, TODAY, HOUR)?.overdue).toBe(false)
  })

  it('겹치지 않는 프로젝트는 바 목록에서 조용히 빠지고 마감 없는 것만 남는다', () => {
    const range = emptyRange()
    const projects = [
      dated({ id: 'p1' }),
      dated({ id: 'p2', startAt: toDueAt('2025-01-01'), dueAt: toDueAt('2025-02-01') }),
      makeProject({ id: 'p3' }),
    ]
    const bars = timelineBars(projects, range, TODAY, HOUR)
    expect(bars.map((b) => b.project.id)).toEqual(['p1', 'p3'])
    expect(bars.map((b) => b.undated)).toEqual([false, true])
  })
})

describe('오늘 선과 눈금', () => {
  it('오늘 위치는 범위 안이다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 120 }), (minDays) => {
        const percent = todayPercent(emptyRange(minDays), TODAY)
        return percent >= 0 && percent <= 100
      }),
    )
  })

  it('범위가 길수록 오늘 선이 왼쪽에 붙는다', () => {
    expect(todayPercent(emptyRange(14), TODAY)).toBeGreaterThan(
      todayPercent(emptyRange(120), TODAY),
    )
  })

  it('눈금은 최대 개수를 넘지 않는다', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 400 }),
        fc.integer({ min: 1, max: 12 }),
        (minDays, maxTicks) => axisTicks(emptyRange(minDays), maxTicks).length <= maxTicks,
      ),
    )
  })

  it('눈금 라벨은 M/D 꼴이고 왼쪽에서 오른쪽으로 커진다', () => {
    const ticks = axisTicks(emptyRange(14), 7)
    expect(ticks.length).toBeGreaterThan(0)
    for (const tick of ticks) expect(tick.label).toMatch(/^\d{1,2}\/\d{1,2}$/)
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]!.percent).toBeGreaterThan(ticks[i - 1]!.percent)
      expect(ticks[i]!.day > ticks[i - 1]!.day).toBe(true)
    }
  })

  it('첫 눈금은 범위의 시작이다', () => {
    const range = emptyRange(30)
    expect(axisTicks(range, 6)[0]?.day).toBe(range.from)
  })
})

describe('할 일 날짜 묶기', () => {
  const todos = [
    makeTodo({ id: 'late', title: '밀린 일', dueAt: toDueAt('2026-03-09', '10:00') }),
    makeTodo({ id: 'now', title: '오늘 일', dueAt: toDueAt('2026-03-12', '10:00') }),
    makeTodo({ id: 'next', title: '내일 일', dueAt: toDueAt('2026-03-13', '10:00') }),
    makeTodo({ id: 'far', title: '나중 일', dueAt: toDueAt('2026-03-20', '10:00') }),
    makeTodo({ id: 'none', title: '언젠가' }),
  ]

  it('지난 기한 · 오늘 · 내일 · 날짜 · 기한 없음 차례로 준다', () => {
    const groups = groupTodosByDue(snap({ todos }), TODAY, HOUR)
    expect(groups.map((g) => g.kind)).toEqual([
      'overdue',
      'today',
      'tomorrow',
      'day',
      'undated',
    ])
    expect(groups.map((g) => g.title)).toEqual([
      '지난 기한',
      '오늘',
      '내일',
      '3/20 (금)',
      '기한 없는 할 일',
    ])
    expect(groups.map((g) => g.items.map((i) => i.todo.id))).toEqual([
      ['late'],
      ['now'],
      ['next'],
      ['far'],
      ['none'],
    ])
  })

  it('해당하는 것이 없는 묶음은 아예 없다', () => {
    const groups = groupTodosByDue(snap({ todos: [todos[1]!] }), TODAY, HOUR)
    expect(groups.map((g) => g.kind)).toEqual(['today'])
  })

  it('하루 경계가 오전 4시라 새벽 2시 마감은 전날 묶음에 들어간다', () => {
    const dawn = makeTodo({ id: 'dawn', dueAt: toDueAt('2026-03-13', '02:00') })
    const groups = groupTodosByDue(snap({ todos: [dawn] }), TODAY, HOUR)
    expect(groups.map((g) => g.kind)).toEqual(['today'])
    expect(groups[0]?.day).toBe(TODAY)
  })

  it('경계를 0시로 두면 같은 마감이 내일로 넘어간다', () => {
    const dawn = makeTodo({ id: 'dawn', dueAt: toDueAt('2026-03-13', '02:00') })
    const groups = groupTodosByDue(snap({ todos: [dawn] }), TODAY, 0)
    expect(groups.map((g) => g.kind)).toEqual(['tomorrow'])
  })

  it('같은 날 세 건은 시각 순으로 늘어선다', () => {
    const sameDay = [
      makeTodo({ id: 'evening', title: '저녁 약속', dueAt: toDueAt('2026-03-12', '17:00') }),
      makeTodo({ id: 'morning', title: '오전 회의', dueAt: toDueAt('2026-03-12', '10:00') }),
      makeTodo({ id: 'noon', title: '치과', dueAt: toDueAt('2026-03-12', '14:00') }),
    ]
    const groups = groupTodosByDue(snap({ todos: sameDay }), TODAY, HOUR)
    expect(groups[0]?.items.map((i) => i.todo.id)).toEqual(['morning', 'noon', 'evening'])
  })

  it('프로젝트 작업과 개인 할 일이 같은 날짜 묶음에 함께 든다', () => {
    const project = makeProject({ id: 'p1', name: '이사 준비' })
    const mixed = [
      makeTodo({ id: 'mine', title: '장보기', dueAt: toDueAt('2026-03-12', '09:00') }),
      makeTodo({
        id: 'task',
        title: '박스 사기',
        projectId: 'p1',
        dueAt: toDueAt('2026-03-12', '15:00'),
      }),
    ]
    const groups = groupTodosByDue(snap({ todos: mixed, projects: [project] }), TODAY, HOUR)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.items.map((i) => i.todo.id)).toEqual(['mine', 'task'])
    expect(groups[0]?.items[0]?.project).toBeUndefined()
    expect(groups[0]?.items[1]?.project?.name).toBe('이사 준비')
  })

  it('기한 없는 프로젝트 작업은 날짜 묶음에 끼지 않는다', () => {
    const project = makeProject({ id: 'p1', name: '이사 준비' })
    const task = makeTodo({ id: 'task', title: '박스 사기', projectId: 'p1' })
    expect(groupTodosByDue(snap({ todos: [task], projects: [project] }), TODAY, HOUR)).toEqual([])
  })

  it('지운 할 일과 완료한 할 일은 묶음에 들어가지 않는다', () => {
    const rows = [
      makeTodo({ id: 'gone', dueAt: toDueAt('2026-03-12', '10:00'), deleted: true }),
      makeTodo({ id: 'finished', dueAt: toDueAt('2026-03-12', '11:00'), status: 'done' }),
      makeTodo({ id: 'alive', dueAt: toDueAt('2026-03-12', '12:00') }),
    ]
    const groups = groupTodosByDue(snap({ todos: rows }), TODAY, HOUR)
    expect(groups[0]?.items.map((i) => i.todo.id)).toEqual(['alive'])
  })

  it('지운 프로젝트에 매달린 작업은 개인 할 일로 본다', () => {
    const project = makeProject({ id: 'p1', name: '이사 준비', deleted: true })
    const task = makeTodo({ id: 'task', title: '박스 사기', projectId: 'p1' })
    const groups = groupTodosByDue(snap({ todos: [task], projects: [project] }), TODAY, HOUR)
    expect(groups.map((g) => g.kind)).toEqual(['undated'])
    expect(groups[0]?.items[0]?.project).toBeUndefined()
  })

  it('지난 기한은 오래된 것부터 늘어놓는다', () => {
    const late = [
      makeTodo({ id: 'b', dueAt: toDueAt('2026-03-10', '10:00') }),
      makeTodo({ id: 'a', dueAt: toDueAt('2026-03-01', '10:00') }),
      makeTodo({ id: 'c', dueAt: toDueAt('2026-03-11', '10:00') }),
    ]
    const groups = groupTodosByDue(snap({ todos: late }), TODAY, HOUR)
    expect(groups[0]?.items.map((i) => i.todo.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('간트 화면', () => {
  it('펼치기 전에는 바가 하나도 없다', async () => {
    mountScreen({ projects: [dated({ id: 'p1' })] })

    expect(await screen.findByRole('button', { name: /일정 보기/ })).toBeTruthy()
    expect(screen.queryByLabelText('이사 준비 2026-03-10부터 2026-03-14까지, D-2')).toBeNull()
  })

  it('바 라벨에 이름과 시작·마감 날짜와 남은 날이 들어간다', async () => {
    mountScreen({ projects: [dated({ id: 'p1' })] })
    await openTimeline()
    expect(
      await screen.findByLabelText('이사 준비 2026-03-10부터 2026-03-14까지, D-2'),
    ).toBeTruthy()
  })

  it('긴 프로젝트도 잘리지 않게 축이 늘어난다', async () => {
    mountScreen({
      projects: [
        dated({ id: 'p1', startAt: toDueAt('2026-01-01'), dueAt: toDueAt('2026-03-14') }),
        dated({ id: 'p2', name: '논문', startAt: toDueAt('2026-03-11'), dueAt: toDueAt('2026-06-30') }),
      ],
    })
    await openTimeline()
    expect(await screen.findByLabelText('이사 준비 2026-01-01부터 2026-03-14까지, D-2')).toBeTruthy()
    expect(screen.getByLabelText('논문 2026-03-11부터 2026-06-30까지, D-110')).toBeTruthy()
    expect(screen.queryByLabelText(/범위 밖/)).toBeNull()
  })

  it('마감이 지난 프로젝트는 라벨로도 알려준다', async () => {
    mountScreen({
      projects: [dated({ id: 'p1', startAt: toDueAt('2026-03-01'), dueAt: toDueAt('2026-03-09') })],
    })
    await openTimeline()
    expect(await screen.findByLabelText(/이사 준비.*D\+3, 기한 지남/)).toBeTruthy()
  })

  it('마감 없는 프로젝트는 따로 모아 알려준다', async () => {
    mountScreen({ projects: [makeProject({ id: 'p1', name: '언젠가 프로젝트' })] })
    await openTimeline()
    const hint = await screen.findByText('마감이 없어 표시할 수 없음')
    expect(hint).toBeTruthy()
    const list = hint.parentElement
    if (!list) throw new Error('안내 묶음이 없습니다')
    expect(within(list).getByText('언젠가 프로젝트')).toBeTruthy()
    expect(screen.queryByLabelText(/언젠가 프로젝트.*까지/)).toBeNull()
  })

  it('프로젝트가 없으면 안내 문구가 뜬다', async () => {
    mountScreen()
    await openTimeline()
    expect(await screen.findByText('표시할 프로젝트가 없습니다.')).toBeTruthy()
  })

  it('바를 누르면 그 프로젝트 상세가 열린다', async () => {
    const user = userEvent.setup()
    mountScreen({
      projects: [dated({ id: 'p1' })],
      todos: [makeTodo({ id: 't1', title: '박스 사기', projectId: 'p1' })],
    })

    await openTimeline()
    await user.click(await screen.findByLabelText(/이사 준비 2026-03-10부터/))
    expect(await screen.findByLabelText('작업 제목')).toBeTruthy()
    expect(screen.getByText('박스 사기')).toBeTruthy()
  })

  it('보류한 프로젝트도 바를 그리되 라벨로 구분한다', async () => {
    mountScreen({ projects: [dated({ id: 'p1', status: 'held' })] })
    await openTimeline()
    expect(await screen.findByLabelText(/이사 준비.*, 보류$/)).toBeTruthy()
  })

  it('완료한 프로젝트도 바를 그리되 라벨로 구분한다', async () => {
    mountScreen({ projects: [dated({ id: 'p1', status: 'done' })] })
    await openTimeline()
    expect(await screen.findByLabelText(/이사 준비.*, 완료$/)).toBeTruthy()
  })
})

describe('할 일 화면 날짜 묶음', () => {
  it('묶음 제목이 지난 기한부터 차례로 붙는다', async () => {
    mountScreen({
      todos: [
        makeTodo({ id: 'late', title: '밀린 일', dueAt: toDueAt('2026-03-09', '10:00') }),
        makeTodo({ id: 'now', title: '오늘 일', dueAt: toDueAt('2026-03-12', '10:00') }),
        makeTodo({ id: 'next', title: '내일 일', dueAt: toDueAt('2026-03-13', '10:00') }),
      ],
    })

    await screen.findByText('지난 기한')
    const titles = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent)
    expect(titles.slice(0, 3)).toEqual(['지난 기한', '오늘', '내일'])
  })

  it('같은 날 세 건이 시각과 함께 한 묶음에 뜬다', async () => {
    mountScreen({
      todos: [
        makeTodo({ id: 't1', title: '오전 회의', dueAt: toDueAt('2026-03-12', '10:00') }),
        makeTodo({ id: 't2', title: '치과', dueAt: toDueAt('2026-03-12', '14:00') }),
        makeTodo({ id: 't3', title: '저녁 약속', dueAt: toDueAt('2026-03-12', '17:00') }),
      ],
    })

    const heading = await screen.findByRole('heading', { level: 2, name: '오늘' })
    const group = heading.closest('section')
    if (!group) throw new Error('묶음을 찾을 수 없습니다')
    expect(within(group).getByText('2026-03-12 10:00')).toBeTruthy()
    expect(within(group).getByText('2026-03-12 14:00')).toBeTruthy()
    expect(within(group).getByText('2026-03-12 17:00')).toBeTruthy()
  })

  it('프로젝트 작업에는 프로젝트 이름 칩이 붙고 개인 할 일에는 붙지 않는다', async () => {
    mountScreen({
      projects: [makeProject({ id: 'p1', name: '이사 준비' })],
      todos: [
        makeTodo({ id: 'mine', title: '장보기', dueAt: toDueAt('2026-03-12', '09:00') }),
        makeTodo({
          id: 'task',
          title: '박스 사기',
          projectId: 'p1',
          dueAt: toDueAt('2026-03-12', '15:00'),
        }),
      ],
    })

    const task = (await screen.findByText('박스 사기')).closest('li')
    const mine = screen.getByText('장보기').closest('li')
    if (!task || !mine) throw new Error('줄을 찾을 수 없습니다')
    expect(within(task).getByText('이사 준비')).toBeTruthy()
    expect(within(mine).queryByText('이사 준비')).toBeNull()
  })

  it('완료하면 묶음에서 내려가 완료 접이로 들어간다', async () => {
    const user = userEvent.setup()
    mountScreen({
      todos: [makeTodo({ id: 't1', title: '장보기', dueAt: toDueAt('2026-03-12', '09:00') })],
    })

    await user.click(await screen.findByRole('button', { name: '장보기 완료 토글' }))
    await waitFor(() => expect(screen.getByText(/완료 1건/)).toBeTruthy())
    expect(screen.queryByRole('heading', { level: 2, name: '오늘' })).toBeNull()
  })

  it('할 일이 하나도 없으면 안내가 그대로 뜬다', async () => {
    mountScreen()
    expect(await screen.findByText('할 일이 없습니다.')).toBeTruthy()
  })
})

describe('프로젝트 시작일 입력', () => {
  it('새 프로젝트에 시작일을 실어 만든다', async () => {
    const user = userEvent.setup()
    mountScreen()

    await user.click(await screen.findByRole('button', { name: '+ 새 프로젝트' }))
    await user.type(screen.getByLabelText('프로젝트 이름'), '논문 마무리')
    const start = screen.getByLabelText('프로젝트 시작일') as HTMLInputElement
    await user.type(start, '2026-03-14')
    await user.type(screen.getByLabelText('프로젝트 마감일'), '2026-03-20')
    await user.click(screen.getByRole('button', { name: '프로젝트 만들기' }))

    await openTimeline()
    expect(await screen.findByLabelText(/논문 마무리 2026-03-14부터 2026-03-20까지/)).toBeTruthy()
  })

  it('상세에서 시작일을 고치면 바가 따라 움직인다', async () => {
    const user = userEvent.setup()
    mountScreen({ projects: [dated({ id: 'p1' })] })

    await openTimeline()
    await user.click(await screen.findByLabelText(/이사 준비 2026-03-10부터/))
    const input = await screen.findByLabelText('프로젝트 시작일')
    expect((input as HTMLInputElement).value).toBe('2026-03-10')
    await user.clear(input)
    await user.type(input, '2026-03-12')
    await user.click(screen.getByRole('button', { name: '← 목록' }))

    await openTimeline()
    expect(
      await screen.findByLabelText('이사 준비 2026-03-12부터 2026-03-14까지, D-2'),
    ).toBeTruthy()
  })
})

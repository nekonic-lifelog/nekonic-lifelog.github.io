// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RowTypes, Snapshot, Store, TableName } from '../src/data/store'
import { fixedClock } from '../src/lib/clock'
import {
  FALLBACK_DUE_TIME,
  dueDateValue,
  dueTimeValue,
  formatDueLabel,
  toDueAt,
} from '../src/lib/due'
import { DEFAULT_SETTINGS, type Settings, type Todo } from '../src/lib/types'
import { AppProvider, mergeById, useApp, type AppApi } from '../src/state/app'
import { Todos } from '../src/screens/Todos'
import { makeProject, makeTodo, resetIds } from './factories'

const NOW = '2026-03-12T20:00:00+09:00'

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

interface Harness {
  snapshot: Snapshot
}

function mountScreen(initial: Partial<Snapshot> = {}): Harness {
  const seen: { app: AppApi | null } = { app: null }

  function Probe(): null {
    seen.app = useApp()
    return null
  }

  render(
    createElement(AppProvider, {
      store: memoryStore(initial),
      clock: fixedClock(NOW),
      children: [
        createElement(Probe, { key: 'probe' }),
        createElement(Todos, { key: 'todos' }),
      ],
    }),
  )

  return {
    get snapshot() {
      if (!seen.app) throw new Error('아직 준비되지 않았습니다')
      return seen.app.snapshot
    },
  }
}

function withSettings(patch: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...patch }
}

function setField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function firstTodo(h: Harness): Todo {
  const found = h.snapshot.todos[0]
  if (!found) throw new Error('할 일이 없습니다')
  return found
}

function todoById(h: Harness, id: string): Todo {
  const found = h.snapshot.todos.find((t) => t.id === id)
  if (!found) throw new Error(`할 일 ${id}를 찾을 수 없습니다`)
  return found
}

beforeEach(resetIds)
afterEach(cleanup)

describe('마감 시각 변환', () => {
  it('날짜와 시각이 그대로 되돌아온다', () => {
    const dueAt = toDueAt('2026-08-03', '14:00')
    expect(dueDateValue(dueAt)).toBe('2026-08-03')
    expect(dueTimeValue(dueAt)).toBe('14:00')
  })

  it('시각을 비우면 정오로 채운다', () => {
    expect(dueTimeValue(toDueAt('2026-08-03', ''))).toBe(FALLBACK_DUE_TIME)
    expect(dueTimeValue(toDueAt('2026-08-03'))).toBe(FALLBACK_DUE_TIME)
    expect(dueTimeValue(toDueAt('2026-08-03', '   '))).toBe('12:00')
  })

  it('날짜가 비면 마감이 없다', () => {
    expect(toDueAt('')).toBeUndefined()
    expect(toDueAt('', '14:00')).toBeUndefined()
    expect(toDueAt('   ', '14:00')).toBeUndefined()
  })

  it('자정과 23:59가 날짜를 넘나들지 않는다', () => {
    const midnight = toDueAt('2026-08-03', '00:00')
    expect(dueDateValue(midnight)).toBe('2026-08-03')
    expect(dueTimeValue(midnight)).toBe('00:00')

    const lastMinute = toDueAt('2026-08-03', '23:59')
    expect(dueDateValue(lastMinute)).toBe('2026-08-03')
    expect(dueTimeValue(lastMinute)).toBe('23:59')
  })

  it('한 자리 시각도 0을 채워 돌려준다', () => {
    expect(dueTimeValue(toDueAt('2026-08-03', '09:05'))).toBe('09:05')
    expect(dueTimeValue(toDueAt('2026-08-03', '9:05'))).toBe('09:05')
  })

  it('초가 붙은 시각도 받는다', () => {
    expect(dueTimeValue(toDueAt('2026-08-03', '14:30:00'))).toBe('14:30')
  })

  it('잘못된 입력에 throw하지 않는다', () => {
    expect(() => toDueAt('언젠가 그때쯤', '해질녘')).not.toThrow()
    expect(toDueAt('언젠가 그때쯤')).toBeUndefined()
    expect(toDueAt('2026-13-01')).toBeUndefined()
    expect(toDueAt('2026-02-31')).toBeUndefined()
    expect(toDueAt('26-8-3')).toBeUndefined()
    expect(dueDateValue('해질녘')).toBe('')
    expect(dueTimeValue('해질녘')).toBe('')
    expect(dueDateValue(undefined)).toBe('')
    expect(dueTimeValue(undefined)).toBe('')
  })

  it('읽을 수 없는 시각은 정오로 되돌린다', () => {
    expect(dueTimeValue(toDueAt('2026-08-03', '해질녘'))).toBe('12:00')
    expect(dueTimeValue(toDueAt('2026-08-03', '25:99'))).toBe('12:00')
  })

  it('저장된 값은 로컬 시각으로 되돌린다', () => {
    expect(dueDateValue('2026-08-03T05:00:00.000Z')).toBe('2026-08-03')
    expect(dueTimeValue('2026-08-03T05:00:00.000Z')).toBe('14:00')
  })

  it('화면 표시는 날짜와 시각을 함께 낸다', () => {
    expect(formatDueLabel(toDueAt('2026-08-03', '14:00') as string)).toBe('2026-08-03 14:00')
    expect(formatDueLabel('2026-08-03T05:00:00.000Z')).toBe('2026-08-03 14:00')
  })

  it('읽을 수 없는 값은 그대로 되돌려준다', () => {
    expect(formatDueLabel('해질녘')).toBe('해질녘')
    expect(() => formatDueLabel('')).not.toThrow()
  })
})

describe('만들 때 시각 넣기', () => {
  it('개인 할 일에 넣은 시각이 정오로 뭉개지지 않는다', async () => {
    const user = userEvent.setup()
    const h = mountScreen()

    await user.type(await screen.findByLabelText('할 일 제목'), '병원 예약')
    setField('기한', '2026-08-03')
    setField('기한 시각', '14:00')
    await user.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => expect(h.snapshot.todos).toHaveLength(1))
    expect(dueDateValue(firstTodo(h).dueAt)).toBe('2026-08-03')
    expect(dueTimeValue(firstTodo(h).dueAt)).toBe('14:00')
  })

  it('개인 할 일에서 시각을 비우면 정오가 된다', async () => {
    const user = userEvent.setup()
    const h = mountScreen()

    await user.type(await screen.findByLabelText('할 일 제목'), '병원 예약')
    setField('기한', '2026-08-03')
    await user.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => expect(h.snapshot.todos).toHaveLength(1))
    expect(dueTimeValue(firstTodo(h).dueAt)).toBe('12:00')
  })

  it('프로젝트 마감에 시각이 들어간다', async () => {
    const user = userEvent.setup()
    const h = mountScreen()

    await user.click(await screen.findByRole('button', { name: '+ 새 프로젝트' }))
    await user.type(screen.getByLabelText('프로젝트 이름'), '논문 마무리')
    setField('프로젝트 마감일', '2026-08-03')
    setField('프로젝트 마감 시각', '17:00')
    await user.click(screen.getByRole('button', { name: '프로젝트 만들기' }))

    await waitFor(() => expect(h.snapshot.projects).toHaveLength(1))
    const project = h.snapshot.projects[0]
    expect(dueDateValue(project?.dueAt)).toBe('2026-08-03')
    expect(dueTimeValue(project?.dueAt)).toBe('17:00')
  })

  it('프로젝트 작업 기한에 시각이 들어간다', async () => {
    const user = userEvent.setup()
    const h = mountScreen({ projects: [makeProject({ id: 'p1', name: '이사 준비' })] })

    await user.click(await screen.findByRole('button', { name: /이사 준비/ }))
    await user.type(screen.getByLabelText('작업 제목'), '박스 사기')
    setField('작업 기한', '2026-08-03')
    setField('작업 기한 시각', '10:00')
    await user.click(screen.getByRole('button', { name: '작업 추가' }))

    await waitFor(() => expect(h.snapshot.todos).toHaveLength(1))
    expect(dueDateValue(firstTodo(h).dueAt)).toBe('2026-08-03')
    expect(dueTimeValue(firstTodo(h).dueAt)).toBe('10:00')
  })

  it('같은 날 세 건이 서로 다른 마감을 갖는다', async () => {
    const user = userEvent.setup()
    const h = mountScreen()

    const plan = [
      ['오전 회의', '10:00'],
      ['치과', '14:00'],
      ['저녁 약속', '17:00'],
    ] as const

    for (const [title, time] of plan) {
      await user.type(await screen.findByLabelText('할 일 제목'), title)
      setField('기한', '2026-08-03')
      setField('기한 시각', time)
      await user.click(screen.getByRole('button', { name: '추가' }))
      await waitFor(() =>
        expect(h.snapshot.todos.some((t) => t.title === title)).toBe(true),
      )
    }

    const byTitle = new Map(h.snapshot.todos.map((t) => [t.title, t.dueAt]))
    expect(dueTimeValue(byTitle.get('오전 회의'))).toBe('10:00')
    expect(dueTimeValue(byTitle.get('치과'))).toBe('14:00')
    expect(dueTimeValue(byTitle.get('저녁 약속'))).toBe('17:00')
    expect(new Set(h.snapshot.todos.map((t) => t.dueAt)).size).toBe(3)
  })
})

describe('만든 뒤 마감 고치기', () => {
  it('개인 할 일의 마감 시각을 고칠 수 있다', async () => {
    const user = userEvent.setup()
    const h = mountScreen({
      todos: [makeTodo({ id: 't1', title: '병원 예약', dueAt: toDueAt('2026-08-03', '12:00') })],
    })

    await user.click(await screen.findByRole('button', { name: '병원 예약 기한 편집' }))
    setField('병원 예약 기한 시각', '10:00')
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(dueTimeValue(todoById(h, 't1').dueAt)).toBe('10:00'))
    expect(dueDateValue(todoById(h, 't1').dueAt)).toBe('2026-08-03')
  })

  it('마감 날짜와 시각을 함께 고칠 수 있다', async () => {
    const user = userEvent.setup()
    const h = mountScreen({
      todos: [makeTodo({ id: 't1', title: '병원 예약', dueAt: toDueAt('2026-08-03', '12:00') })],
    })

    await user.click(await screen.findByRole('button', { name: '병원 예약 기한 편집' }))
    setField('병원 예약 기한 날짜', '2026-08-05')
    setField('병원 예약 기한 시각', '17:30')
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(dueDateValue(todoById(h, 't1').dueAt)).toBe('2026-08-05'))
    expect(dueTimeValue(todoById(h, 't1').dueAt)).toBe('17:30')
  })

  it('편집을 열면 지금 마감이 입력에 들어와 있다', async () => {
    const user = userEvent.setup()
    mountScreen({
      todos: [makeTodo({ id: 't1', title: '병원 예약', dueAt: toDueAt('2026-08-03', '09:05') })],
    })

    await user.click(await screen.findByRole('button', { name: '병원 예약 기한 편집' }))
    expect((screen.getByLabelText('병원 예약 기한 날짜') as HTMLInputElement).value).toBe(
      '2026-08-03',
    )
    expect((screen.getByLabelText('병원 예약 기한 시각') as HTMLInputElement).value).toBe(
      '09:05',
    )
  })

  it('마감이 없던 할 일에도 마감을 붙일 수 있다', async () => {
    const user = userEvent.setup()
    const h = mountScreen({ todos: [makeTodo({ id: 't1', title: '언젠가' })] })

    await user.click(await screen.findByRole('button', { name: '언젠가 기한 편집' }))
    setField('언젠가 기한 날짜', '2026-08-03')
    setField('언젠가 기한 시각', '08:30')
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(dueTimeValue(todoById(h, 't1').dueAt)).toBe('08:30'))
  })

  it('마감을 지울 수 있고 D-day 고정도 함께 풀린다', async () => {
    const user = userEvent.setup()
    const h = mountScreen({
      todos: [
        makeTodo({
          id: 't1',
          title: '병원 예약',
          pinned: true,
          dueAt: toDueAt('2026-08-03', '14:00'),
        }),
      ],
    })

    await user.click(await screen.findByRole('button', { name: '병원 예약 기한 편집' }))
    await user.click(screen.getByRole('button', { name: '기한 지우기' }))

    await waitFor(() => expect(todoById(h, 't1').dueAt).toBeUndefined())
    expect(todoById(h, 't1').pinned).toBe(false)
    expect(await screen.findByText('기한 없음')).toBeTruthy()
  })

  it('취소하면 마감이 그대로다', async () => {
    const user = userEvent.setup()
    const h = mountScreen({
      todos: [makeTodo({ id: 't1', title: '병원 예약', dueAt: toDueAt('2026-08-03', '14:00') })],
    })

    await user.click(await screen.findByRole('button', { name: '병원 예약 기한 편집' }))
    setField('병원 예약 기한 시각', '06:00')
    await user.click(screen.getByRole('button', { name: '취소' }))

    await screen.findByRole('button', { name: '병원 예약 기한 편집' })
    expect(dueTimeValue(todoById(h, 't1').dueAt)).toBe('14:00')
  })

  it('프로젝트 작업의 마감 시각도 고칠 수 있다', async () => {
    const user = userEvent.setup()
    const h = mountScreen({
      projects: [makeProject({ id: 'p1', name: '이사 준비' })],
      todos: [
        makeTodo({
          id: 't1',
          title: '박스 사기',
          projectId: 'p1',
          dueAt: toDueAt('2026-08-03', '12:00'),
        }),
      ],
    })

    await user.click(await screen.findByRole('button', { name: /이사 준비/ }))
    await user.click(await screen.findByRole('button', { name: '박스 사기 기한 편집' }))
    setField('박스 사기 기한 시각', '17:00')
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(dueTimeValue(todoById(h, 't1').dueAt)).toBe('17:00'))
  })
})

describe('마감 시각 보여주기', () => {
  it('행에 날짜와 시각이 함께 뜬다', async () => {
    mountScreen({
      todos: [makeTodo({ id: 't1', title: '병원 예약', dueAt: toDueAt('2026-08-03', '14:00') })],
    })

    expect(await screen.findByText('2026-08-03 14:00')).toBeTruthy()
  })

  it('같은 날 세 건이 서로 다른 시각으로 보인다', async () => {
    mountScreen({
      todos: [
        makeTodo({ id: 't1', title: '오전 회의', dueAt: toDueAt('2026-08-03', '10:00') }),
        makeTodo({ id: 't2', title: '치과', dueAt: toDueAt('2026-08-03', '14:00') }),
        makeTodo({ id: 't3', title: '저녁 약속', dueAt: toDueAt('2026-08-03', '17:00') }),
      ],
    })

    expect(await screen.findByText('2026-08-03 10:00')).toBeTruthy()
    expect(screen.getByText('2026-08-03 14:00')).toBeTruthy()
    expect(screen.getByText('2026-08-03 17:00')).toBeTruthy()
  })

  it('D-day 칩은 그대로 붙는다', async () => {
    mountScreen({
      todos: [makeTodo({ id: 't1', title: '병원 예약', dueAt: toDueAt('2026-03-15', '10:00') })],
    })

    expect(await screen.findByText('D-3')).toBeTruthy()
  })
})

describe('알림 칩', () => {
  const dueAt = toDueAt('2026-08-03', '14:00')

  it('오프셋이 몇 개든 표시는 하나뿐이다', async () => {
    mountScreen({
      todos: [makeTodo({ id: 't1', title: '병원 예약', dueAt })],
      settings: withSettings({ defaultOffsets: [2880, 1440, 120, 60] }),
    })

    const chips = await screen.findAllByLabelText(/알림 예정/)
    expect(chips).toHaveLength(1)
    expect(chips[0]?.textContent).toBe('알림 4')
  })

  it('설정에 담긴 오프셋만 라벨에 담는다', async () => {
    mountScreen({
      todos: [makeTodo({ id: 't1', title: '병원 예약', dueAt })],
      settings: withSettings({ defaultOffsets: [1440, 60] }),
    })

    const chip = await screen.findByLabelText(/알림 예정/)
    expect(chip.textContent).toBe('알림 2')
    const label = chip.getAttribute('aria-label') ?? ''
    expect(label).toContain('2026-08-02 14:00')
    expect(label).toContain('2026-08-03 13:00')
    expect(label).not.toContain('2026-08-01 14:00')
    expect(label).not.toContain('2026-08-03 12:00')
  })

  it('오프셋이 비면 칩을 그리지 않는다', async () => {
    mountScreen({
      todos: [makeTodo({ id: 't1', title: '병원 예약', dueAt })],
      settings: withSettings({ defaultOffsets: [] }),
    })

    await screen.findByText('2026-08-03 14:00')
    expect(screen.queryByLabelText(/알림 예정/)).toBeNull()
  })

  it('한 시간이 안 되는 오프셋은 분으로, 어중간한 값은 시간으로 적는다', async () => {
    mountScreen({
      todos: [makeTodo({ id: 't1', title: '병원 예약', dueAt })],
      settings: withSettings({ defaultOffsets: [90, 30] }),
    })

    const label = (await screen.findByLabelText(/알림 예정/)).getAttribute('aria-label') ?? ''
    expect(label).toContain('1.5h 전')
    expect(label).toContain('30분 전')
  })

  it('칩이 실제 발송 시각을 알려준다', async () => {
    mountScreen({
      todos: [makeTodo({ id: 't1', title: '병원 예약', dueAt })],
      settings: withSettings({ defaultOffsets: [60] }),
    })

    const chip = await screen.findByLabelText(/알림 예정/)
    expect(chip.getAttribute('title')).toBe('알림 예정 1번: 2026-08-03 13:00 (1h 전)')
    expect(chip.getAttribute('title')).toBe(chip.getAttribute('aria-label'))
  })

  it('큰 오프셋부터 늘어놓고 겹치는 값은 한 번만 적는다', async () => {
    mountScreen({
      todos: [makeTodo({ id: 't1', title: '병원 예약', dueAt })],
      settings: withSettings({ defaultOffsets: [60, 1440, 60, 0, -5] }),
    })

    const chip = await screen.findByLabelText(/알림 예정/)
    expect(chip.getAttribute('aria-label')).toBe(
      '알림 예정 2번: 2026-08-02 14:00 (24h 전), 2026-08-03 13:00 (1h 전)',
    )
  })

  it('기한이 없으면 칩도 없다', async () => {
    mountScreen({ todos: [makeTodo({ id: 't1', title: '언젠가' })] })

    await screen.findByText('기한 없음')
    expect(screen.queryByLabelText(/알림 예정/)).toBeNull()
  })

  it('기한이 이미 지났으면 칩을 그리지 않는다', async () => {
    mountScreen({
      todos: [
        makeTodo({ id: 't1', title: '지난 약속', dueAt: toDueAt('2026-03-01', '10:00') }),
      ],
    })

    await screen.findByText('2026-03-01 10:00')
    expect(screen.queryByLabelText(/알림 예정/)).toBeNull()
  })

  it('완료한 항목에는 칩을 그리지 않는다', async () => {
    const user = userEvent.setup()
    mountScreen({
      todos: [makeTodo({ id: 't1', title: '병원 예약', status: 'done', dueAt })],
    })

    await user.click(await screen.findByRole('button', { name: /완료 1건/ }))
    expect(await screen.findByText('2026-08-03 14:00')).toBeTruthy()
    expect(screen.queryByLabelText(/알림 예정/)).toBeNull()
  })
})

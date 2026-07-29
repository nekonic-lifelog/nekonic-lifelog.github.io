// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RowTypes, Snapshot, Store, TableName } from '../src/data/store'
import { fixedClock, mutableClock, type Clock } from '../src/lib/clock'
import { DEFAULT_SETTINGS, type Todo } from '../src/lib/types'
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

function mountScreen(initial: Partial<Snapshot> = {}, clock: Clock = fixedClock(NOW)) {
  const seen: { app: AppApi | null } = { app: null }

  function Probe(): null {
    seen.app = useApp()
    return null
  }

  render(
    <AppProvider store={memoryStore(initial)} clock={clock}>
      <Probe />
      <Todos />
    </AppProvider>,
  )

  return {
    get snapshot() {
      if (!seen.app) throw new Error('아직 준비되지 않았습니다')
      return seen.app.snapshot
    },
  }
}

function byId(snapshot: Snapshot, id: string): Todo {
  const found = snapshot.todos.find((t) => t.id === id)
  if (!found) throw new Error(`할 일 ${id}를 찾을 수 없습니다`)
  return found
}

const undoButton = () => screen.queryByRole('button', { name: '되돌리기' })

beforeEach(() => {
  resetIds()
  window.location.hash = ''
})
afterEach(cleanup)

describe('할 일 삭제 되돌리기', () => {
  it('할 일을 지우면 되돌리기가 뜬다', async () => {
    const user = userEvent.setup()
    mountScreen({ todos: [makeTodo({ id: 't1', title: '치과' })] })

    expect(undoButton()).toBeNull()

    await user.click(await screen.findByLabelText('치과 삭제'))

    await waitFor(() => expect(undoButton()).toBeTruthy())
    expect(screen.getByRole('status').textContent).toContain('치과')
  })

  it('되돌리기를 누르면 그 할 일이 살아난다', async () => {
    const user = userEvent.setup()
    const h = mountScreen({ todos: [makeTodo({ id: 't1', title: '치과' })] })

    await user.click(await screen.findByLabelText('치과 삭제'))
    await waitFor(() => expect(byId(h.snapshot, 't1').deleted).toBe(true))
    expect(screen.queryByText('치과')).toBeNull()

    await user.click(await screen.findByRole('button', { name: '되돌리기' }))

    await waitFor(() => expect(byId(h.snapshot, 't1').deleted).toBe(false))
    expect(await screen.findByText('치과')).toBeTruthy()
    expect(undoButton()).toBeNull()
  })

  it('되돌린 할 일은 tombstone이 풀린 것이지 새로 만들어진 것이 아니다', async () => {
    const user = userEvent.setup()
    const h = mountScreen({ todos: [makeTodo({ id: 't1', title: '치과' })] })

    await screen.findByText('치과')
    const before = byId(h.snapshot, 't1')

    await user.click(await screen.findByLabelText('치과 삭제'))
    await waitFor(() => expect(byId(h.snapshot, 't1').deleted).toBe(true))
    await user.click(await screen.findByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(byId(h.snapshot, 't1').deleted).toBe(false))

    expect(h.snapshot.todos).toHaveLength(1)
    const after = byId(h.snapshot, 't1')
    expect(after.id).toBe(before.id)
    expect(after.id).toBe('t1')
    expect(after.createdAt).toBe(before.createdAt)
  })

  it('시간이 지나면 되돌리기가 사라진다', async () => {
    const user = userEvent.setup()
    const clock = mutableClock(NOW)
    mountScreen({ todos: [makeTodo({ id: 't1', title: '치과' })] }, clock)

    await user.click(await screen.findByLabelText('치과 삭제'))
    await waitFor(() => expect(undoButton()).toBeTruthy())

    clock.advanceHours(1)

    await waitFor(() => expect(undoButton()).toBeNull(), { timeout: 3000 })
  })

  it('시계가 멈춰 있으면 되돌리기도 남아 있다', async () => {
    const user = userEvent.setup()
    const clock = mutableClock(NOW)
    mountScreen({ todos: [makeTodo({ id: 't1', title: '치과' })] }, clock)

    await user.click(await screen.findByLabelText('치과 삭제'))
    await waitFor(() => expect(undoButton()).toBeTruthy())

    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(undoButton()).toBeTruthy()
  })

  it('되돌리기가 사라진 뒤에도 데이터는 지워진 채 그대로다', async () => {
    const user = userEvent.setup()
    const clock = mutableClock(NOW)
    const h = mountScreen({ todos: [makeTodo({ id: 't1', title: '치과' })] }, clock)

    await user.click(await screen.findByLabelText('치과 삭제'))
    await waitFor(() => expect(undoButton()).toBeTruthy())

    clock.advanceHours(1)
    await waitFor(() => expect(undoButton()).toBeNull(), { timeout: 3000 })

    expect(byId(h.snapshot, 't1').deleted).toBe(true)
    expect(screen.queryByText('치과')).toBeNull()
  })

  it('연달아 두 개를 지우면 마지막 것만 되돌린다', async () => {
    const user = userEvent.setup()
    const h = mountScreen({
      todos: [
        makeTodo({ id: 't1', title: '치과' }),
        makeTodo({ id: 't2', title: '장보기' }),
      ],
    })

    await user.click(await screen.findByLabelText('치과 삭제'))
    await waitFor(() => expect(byId(h.snapshot, 't1').deleted).toBe(true))
    await user.click(await screen.findByLabelText('장보기 삭제'))
    await waitFor(() => expect(byId(h.snapshot, 't2').deleted).toBe(true))

    expect(screen.getByRole('status').textContent).toContain('장보기')

    await user.click(await screen.findByRole('button', { name: '되돌리기' }))

    await waitFor(() => expect(byId(h.snapshot, 't2').deleted).toBe(false))
    expect(byId(h.snapshot, 't1').deleted).toBe(true)
    expect(undoButton()).toBeNull()
  })
})

describe('할 일 완료 되돌리기', () => {
  it('완료 처리도 되돌릴 수 있다', async () => {
    const user = userEvent.setup()
    const h = mountScreen({ todos: [makeTodo({ id: 't1', title: '치과' })] })

    await user.click(await screen.findByLabelText('치과 완료 토글'))
    await waitFor(() => expect(byId(h.snapshot, 't1').status).toBe('done'))

    await user.click(await screen.findByRole('button', { name: '되돌리기' }))

    await waitFor(() => expect(byId(h.snapshot, 't1').status).toBe('todo'))
    expect(byId(h.snapshot, 't1').doneAt).toBeUndefined()
    expect(byId(h.snapshot, 't1').deleted).toBe(false)
  })

  it('완료를 푸는 것은 되돌리기를 띄우지 않는다', async () => {
    const user = userEvent.setup()
    const h = mountScreen({
      todos: [makeTodo({ id: 't1', title: '치과', status: 'done', doneAt: NOW })],
    })

    await user.click(await screen.findByRole('button', { name: /완료 1건/ }))
    await user.click(await screen.findByLabelText('치과 완료 토글'))

    await waitFor(() => expect(byId(h.snapshot, 't1').status).toBe('todo'))
    expect(undoButton()).toBeNull()
  })
})

describe('체크리스트 항목 되돌리기', () => {
  const seed = {
    projects: [
      makeProject({
        id: 'p1',
        name: '이사 준비',
        checklist: [
          { id: 'c1', text: '계약서', done: false },
          { id: 'c2', text: '박스 주문', done: true },
        ],
      }),
    ],
  }

  it('체크리스트 항목을 지워도 되돌릴 수 있다', async () => {
    const user = userEvent.setup()
    const h = mountScreen(seed)

    await user.click(await screen.findByRole('button', { name: /이사 준비/ }))
    await user.click(await screen.findByRole('button', { name: /체크리스트 펼치기/ }))
    await user.click(await screen.findByLabelText('계약서 항목 삭제'))

    await waitFor(() => expect(screen.queryByText('계약서')).toBeNull())
    expect(undoButton()).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: '되돌리기' }))

    expect(await screen.findByText('계약서')).toBeTruthy()
    const project = h.snapshot.projects.find((p) => p.id === 'p1')
    expect(project?.checklist?.map((i) => i.id)).toEqual(['c1', 'c2'])
    expect(project?.checklist?.map((i) => i.done)).toEqual([false, true])
  })
})

describe('할 일 탭의 일정', () => {
  const seed = {
    projects: [
      makeProject({
        id: 'p1',
        name: '이사 준비',
        startAt: '2026-03-10T00:00:00+09:00',
        dueAt: '2026-03-20T12:00:00+09:00',
      }),
    ],
  }

  it('일정 보기는 접힌 채로 시작한다', async () => {
    mountScreen(seed)

    const toggle = await screen.findByRole('button', { name: /일정 보기/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('heading', { name: '일정' })).toBeNull()
    expect(document.querySelector('.tl__chart')).toBeNull()
  })

  it('펼치면 일정이 보인다', async () => {
    const user = userEvent.setup()
    mountScreen(seed)

    await user.click(await screen.findByRole('button', { name: /일정 보기/ }))

    expect(await screen.findByRole('heading', { name: '일정' })).toBeTruthy()
    expect(document.querySelector('.tl__chart')).toBeTruthy()
    expect(screen.getByRole('button', { name: /일정 보기/ }).getAttribute('aria-expanded')).toBe(
      'true',
    )
  })

  it('다시 접으면 일정이 사라진다', async () => {
    const user = userEvent.setup()
    mountScreen(seed)

    await user.click(await screen.findByRole('button', { name: /일정 보기/ }))
    await screen.findByRole('heading', { name: '일정' })
    await user.click(screen.getByRole('button', { name: /일정 보기/ }))

    expect(screen.queryByRole('heading', { name: '일정' })).toBeNull()
  })
})

describe('진행 막대 설명', () => {
  const seed = {
    projects: [makeProject({ id: 'p1', name: '이사 준비' })],
    todos: [
      makeTodo({ id: 't1', projectId: 'p1', title: '박스 사기', status: 'done' }),
      makeTodo({ id: 't2', projectId: 'p1', title: '계약서', status: 'todo' }),
    ],
  }

  it('프로젝트 카드의 진행 막대에 문장 설명이 붙는다', async () => {
    mountScreen(seed)

    const card = await screen.findByRole('button', { name: /이사 준비/ })
    const bar = within(card).getByRole('img', { name: '이사 준비 진행률 50퍼센트' })
    expect(bar.classList.contains('project-bar')).toBe(true)
  })

  it('프로젝트 상세의 진행 막대에도 같은 설명이 붙는다', async () => {
    const user = userEvent.setup()
    mountScreen(seed)

    await user.click(await screen.findByRole('button', { name: /이사 준비/ }))

    const bar = await screen.findByRole('img', { name: '이사 준비 진행률 50퍼센트' })
    expect(bar.classList.contains('project-bar')).toBe(true)
  })

  it('작업이 없으면 0퍼센트로 읽힌다', async () => {
    mountScreen({ projects: [makeProject({ id: 'p1', name: '이사 준비' })] })

    expect(await screen.findByRole('img', { name: '이사 준비 진행률 0퍼센트' })).toBeTruthy()
  })
})

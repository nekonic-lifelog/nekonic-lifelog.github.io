// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RowTypes, Snapshot, Store, TableName } from '../src/data/store'
import { fixedClock, type Clock } from '../src/lib/clock'
import { logicalDay } from '../src/lib/day'
import { DEFAULT_SETTINGS, type Todo } from '../src/lib/types'
import { AppProvider, mergeById } from '../src/state/app'
import { Today } from '../src/screens/Today'
import { dailyRecords, makeDef, makeProject, makeTodo, resetIds } from './factories'

const NOW = '2026-03-12T20:00:00+09:00'
const TODAY = '2026-03-12'
const YESTERDAY = '2026-03-11'
const HOUR = DEFAULT_SETTINGS.dayBoundaryHour

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

function memoryStore(initial: Partial<Snapshot> = {}) {
  const data = snap(initial)
  const store: Store = {
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
  return { store, data }
}

function mountToday(initial: Partial<Snapshot> = {}, clock: Clock = fixedClock(NOW)) {
  const { store, data } = memoryStore(initial)
  const view = render(
    <AppProvider store={store} clock={clock}>
      <Today />
    </AppProvider>,
  )
  return { ...view, data }
}

async function todoCard(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: /할 일$/ })
  const section = heading.closest('section')
  if (!section) throw new Error('할 일 카드를 찾지 못했습니다')
  return section as HTMLElement
}

function titleField(): HTMLInputElement {
  return screen.getByLabelText('할 일 제목') as HTMLInputElement
}

function addButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '할 일 추가' }) as HTMLButtonElement
}

function livingTodos(data: Snapshot): Todo[] {
  return data.todos.filter((t) => !t.deleted)
}

function dueTodo(day: string, overrides: Partial<Todo> = {}): Todo {
  return makeTodo({ dueAt: `${day}T12:00:00+09:00`, ...overrides })
}

beforeEach(() => {
  resetIds()
})

afterEach(() => {
  cleanup()
})

describe('오늘 화면 — 한 줄로 할 일 적기', () => {
  it('제목만 넣고 추가하면 보고 있는 날 기한으로 만들어진다', async () => {
    const user = userEvent.setup()
    const { data } = mountToday()
    await todoCard()

    await user.type(titleField(), '우유 사기')
    await user.click(addButton())

    await waitFor(() => expect(livingTodos(data)).toHaveLength(1))
    const made = livingTodos(data)[0]!
    expect(made.title).toBe('우유 사기')
    expect(made.dueAt).toBeTruthy()
    expect(logicalDay(made.dueAt!, HOUR)).toBe(TODAY)

    expect(within(await todoCard()).getByText('우유 사기')).toBeTruthy()
  })

  it('적고 나면 입력칸이 비어 다음 것을 바로 적을 수 있다', async () => {
    const user = userEvent.setup()
    mountToday()
    await todoCard()

    await user.type(titleField(), '우유 사기')
    await user.click(addButton())

    await waitFor(() => expect(titleField().value).toBe(''))
  })

  it('보고 있는 날을 어제로 옮긴 뒤 추가하면 어제 기한이 된다', async () => {
    const user = userEvent.setup()
    const { data } = mountToday()
    await todoCard()

    await user.click(screen.getByRole('button', { name: '이전 날' }))
    await user.type(titleField(), '어제 못 한 것')
    await user.click(addButton())

    await waitFor(() => expect(livingTodos(data)).toHaveLength(1))
    expect(logicalDay(livingTodos(data)[0]!.dueAt!, HOUR)).toBe(YESTERDAY)
  })

  it('빈 제목으로는 추가되지 않는다', async () => {
    const user = userEvent.setup()
    const { data } = mountToday()
    await todoCard()

    expect(addButton().disabled).toBe(true)

    await user.type(titleField(), '   ')
    expect(addButton().disabled).toBe(true)

    await user.type(titleField(), '{Enter}')
    expect(livingTodos(data)).toHaveLength(0)
  })
})

describe('오늘 화면 — 지난 기한 묶음', () => {
  const late = () => dueTodo('2026-03-09', { id: 'late-1', title: '밀린 서류' })
  const later = () => dueTodo('2026-03-10', { id: 'late-2', title: '밀린 전화' })
  const now = () => dueTodo(TODAY, { id: 'now-1', title: '오늘 장보기' })

  it('지난 기한이 있으면 개수와 함께 접혀 있다', async () => {
    mountToday({ todos: [late(), later(), now()] })
    const card = await todoCard()

    const toggle = within(card).getByRole('button', { name: /지난 기한 2건/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(within(card).queryByText('밀린 서류')).toBeFalsy()
    expect(within(card).queryByText('밀린 전화')).toBeFalsy()
    expect(within(card).getByText('오늘 장보기')).toBeTruthy()
  })

  it('접힌 것을 펼치면 지난 기한 할 일이 보인다', async () => {
    const user = userEvent.setup()
    mountToday({ todos: [late(), later(), now()] })
    const card = await todoCard()

    await user.click(within(card).getByRole('button', { name: /지난 기한 2건/ }))

    expect(await within(card).findByText('밀린 서류')).toBeTruthy()
    expect(within(card).getByText('밀린 전화')).toBeTruthy()
    expect(
      within(card).getByRole('button', { name: /지난 기한 2건/ }).getAttribute('aria-expanded'),
    ).toBe('true')
  })

  it('지난 기한이 없으면 그 묶음이 아예 없다', async () => {
    mountToday({ todos: [now()] })
    const card = await todoCard()

    expect(within(card).queryByRole('button', { name: /지난 기한/ })).toBeFalsy()
    expect(within(card).getByText('오늘 장보기')).toBeTruthy()
  })

  it('지난 기한 할 일에는 늦은 것을 알리는 표시가 붙는다', async () => {
    const user = userEvent.setup()
    mountToday({ todos: [late(), now()] })
    const card = await todoCard()

    await user.click(within(card).getByRole('button', { name: /지난 기한 1건/ }))

    const row = (await within(card).findByText('밀린 서류')).closest('li')
    expect(row?.className).toContain('todo--overdue')
  })

  it('며칠 지났는지가 문장으로도 읽힌다', async () => {
    const user = userEvent.setup()
    mountToday({ todos: [late(), now()] })
    const card = await todoCard()

    await user.click(within(card).getByRole('button', { name: /지난 기한 1건/ }))

    expect(await within(card).findByLabelText('기한 2026-03-09, 3일 지남')).toBeTruthy()
    expect(within(card).getByText('D+3')).toBeTruthy()
  })

  it('그 날 기한인 할 일에는 날짜를 되풀이하지 않는다', async () => {
    mountToday({ todos: [now()] })
    const card = await todoCard()

    const row = within(card).getByText('오늘 장보기').closest('li')!
    expect(within(row as HTMLElement).queryByText(/^D[-+]/)).toBeFalsy()
    expect(row.textContent).not.toContain(TODAY)
  })
})

describe('오늘 화면 — 프로젝트 알아보기', () => {
  const project = () => makeProject({ id: 'proj-1', name: '이사 준비' })

  it('프로젝트 작업에는 프로젝트 이름이 붙는다', async () => {
    mountToday({
      projects: [project()],
      todos: [dueTodo(TODAY, { id: 'task-1', title: '박스 사기', projectId: 'proj-1' })],
    })
    const card = await todoCard()

    const row = within(card).getByText('박스 사기').closest('li')!
    expect(within(row as HTMLElement).getByText('이사 준비')).toBeTruthy()
  })

  it('개인 할 일에는 프로젝트 이름이 붙지 않는다', async () => {
    mountToday({
      projects: [project()],
      todos: [dueTodo(TODAY, { id: 'solo-1', title: '우편함 확인' })],
    })
    const card = await todoCard()

    const row = within(card).getByText('우편함 확인').closest('li')!
    expect(within(row as HTMLElement).queryByText('이사 준비')).toBeFalsy()
  })
})

describe('오늘 화면 — 눈으로만 읽히던 것들', () => {
  it('최근 7일 점에 문장 설명이 붙는다 — 목표 요일이 없는 습관에서도', async () => {
    const def = makeDef({ id: 'pill', name: '아침 약' })
    mountToday({
      definitions: [def],
      records: dailyRecords('pill', ['2026-03-10', '2026-03-11', '2026-03-12']),
    })

    expect(await screen.findByLabelText('최근 7일 중 3일 달성')).toBeTruthy()
  })

  it('목표 요일이 있으면 설명이 목표 요일 수까지 알려준다', async () => {
    const def = makeDef({ id: 'gym', name: '운동', targetDays: [1, 3, 5] })
    mountToday({ definitions: [def], records: dailyRecords('gym', ['2026-03-11']) })

    expect(await screen.findByLabelText(/최근 7일 중 목표 요일은 3일/)).toBeTruthy()
  })

  it('스트릭에 문장 설명이 붙는다', async () => {
    const def = makeDef({ id: 'pill', name: '아침 약' })
    mountToday({
      definitions: [def],
      records: dailyRecords('pill', ['2026-03-10', '2026-03-11', '2026-03-12']),
    })

    expect(await screen.findByLabelText('아침 약 연속 3일 달성')).toBeTruthy()
    expect(screen.getByText('🔥 3')).toBeTruthy()
  })

  it('연속이 끊겼으면 끊겼다고 읽힌다', async () => {
    const def = makeDef({ id: 'pill', name: '아침 약' })
    mountToday({ definitions: [def] })

    expect(await screen.findByLabelText('아침 약 연속 달성 없음')).toBeTruthy()
  })
})

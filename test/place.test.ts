// @vitest-environment jsdom
import { createElement, type FunctionComponent } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RowTypes, Snapshot, Store, TableName } from '../src/data/store'
import { parseBackup } from '../src/lib/backup'
import { fixedClock } from '../src/lib/clock'
import { toDueAt } from '../src/lib/due'
import {
  summarizeNote,
  todoNoteSummary,
  todoPlace,
} from '../src/lib/selectProjects'
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../src/lib/types'
import type { Todo } from '../src/lib/types'
import { AppProvider, mergeById, useApp, type AppApi } from '../src/state/app'
import { useTodos, type TodosApi } from '../src/state/todos'
import { Today } from '../src/screens/Today'
import { Todos } from '../src/screens/Todos'
import { makeProject, makeTodo, resetIds } from './factories'

const NOW = '2026-03-12T20:00:00+09:00'
const TODAY = '2026-03-12'

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
  api: TodosApi
  snapshot: Snapshot
}

async function mountApi(initial: Partial<Snapshot> = {}): Promise<Harness> {
  const seen: { api: TodosApi | null; app: AppApi | null } = { api: null, app: null }

  function Probe(): null {
    seen.api = useTodos()
    seen.app = useApp()
    return null
  }

  render(
    createElement(AppProvider, {
      store: memoryStore(initial),
      clock: fixedClock(NOW),
      children: createElement(Probe),
    }),
  )
  await waitFor(() => expect(seen.app?.ready).toBe(true))

  return {
    get api() {
      if (!seen.api) throw new Error('아직 준비되지 않았습니다')
      return seen.api
    },
    get snapshot() {
      if (!seen.app) throw new Error('아직 준비되지 않았습니다')
      return seen.app.snapshot
    },
  }
}

function mountWith(node: FunctionComponent, initial: Partial<Snapshot> = {}) {
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
        createElement(node, { key: 'screen' }),
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

const mountScreen = (initial: Partial<Snapshot> = {}) => mountWith(Todos, initial)
const mountToday = (initial: Partial<Snapshot> = {}) => mountWith(Today, initial)

function first(snapshot: Snapshot): Todo {
  const found = snapshot.todos.find((t) => !t.deleted)
  if (!found) throw new Error('할 일이 없습니다')
  return found
}

function byId(snapshot: Snapshot, id: string): Todo {
  const found = snapshot.todos.find((t) => t.id === id)
  if (!found) throw new Error(`할 일 ${id}를 찾을 수 없습니다`)
  return found
}

beforeEach(resetIds)
afterEach(cleanup)

describe('장소와 메모 담기', () => {
  it('장소와 메모를 넣어 만들면 그대로 담긴다', async () => {
    const h = await mountApi()

    await act(async () => {
      await h.api.addTodo({ title: '치과', place: '강남역 3번 출구', note: '보험증 챙기기' })
    })

    const todo = first(h.snapshot)
    expect(todo.place).toBe('강남역 3번 출구')
    expect(todo.note).toBe('보험증 챙기기')
  })

  it('안 넣으면 두 필드가 undefined다', async () => {
    const h = await mountApi()

    await act(async () => {
      await h.api.addTodo({ title: '치과' })
    })

    const todo = first(h.snapshot)
    expect(todo.place).toBeUndefined()
    expect(todo.note).toBeUndefined()
  })

  it('공백만 넣으면 빈 문자열이 아니라 undefined로 담긴다', async () => {
    const h = await mountApi()

    await act(async () => {
      await h.api.addTodo({ title: '치과', place: '   ', note: '\n\t ' })
    })

    const todo = first(h.snapshot)
    expect(todo.place).toBeUndefined()
    expect(todo.note).toBeUndefined()
    expect(todo.place).not.toBe('')
    expect(todo.note).not.toBe('')
  })

  it('앞뒤 공백은 다듬어서 담는다', async () => {
    const h = await mountApi()

    await act(async () => {
      await h.api.addTodo({ title: '치과', place: '  강남역  ', note: '  보험증  ' })
    })

    const todo = first(h.snapshot)
    expect(todo.place).toBe('강남역')
    expect(todo.note).toBe('보험증')
  })

  it('이미 만든 할 일에 나중에 붙이고 고치고 지운다', async () => {
    const h = await mountApi({ todos: [makeTodo({ id: 't1', title: '치과' })] })

    await act(async () => {
      await h.api.editTodo(byId(h.snapshot, 't1'), { place: '강남역', note: '보험증' })
    })
    expect(byId(h.snapshot, 't1').place).toBe('강남역')
    expect(byId(h.snapshot, 't1').note).toBe('보험증')

    await act(async () => {
      await h.api.editTodo(byId(h.snapshot, 't1'), { place: '역삼역', note: '진료 카드' })
    })
    expect(byId(h.snapshot, 't1').place).toBe('역삼역')
    expect(byId(h.snapshot, 't1').note).toBe('진료 카드')

    await act(async () => {
      await h.api.editTodo(byId(h.snapshot, 't1'), { place: '', note: '   ' })
    })
    expect(byId(h.snapshot, 't1').place).toBeUndefined()
    expect(byId(h.snapshot, 't1').note).toBeUndefined()
  })

  it('고칠 때도 앞뒤 공백을 다듬는다', async () => {
    const h = await mountApi({ todos: [makeTodo({ id: 't1' })] })

    await act(async () => {
      await h.api.editTodo(byId(h.snapshot, 't1'), { place: '  강남역  ' })
    })

    expect(byId(h.snapshot, 't1').place).toBe('강남역')
  })

  it('두 필드를 건드리지 않는 수정은 담긴 값을 흔들지 않는다', async () => {
    const h = await mountApi({
      todos: [makeTodo({ id: 't1', place: '강남역', note: '보험증' })],
    })

    await act(async () => {
      await h.api.editTodo(byId(h.snapshot, 't1'), { pinned: true })
    })

    expect(byId(h.snapshot, 't1').place).toBe('강남역')
    expect(byId(h.snapshot, 't1').note).toBe('보험증')
  })

  it('프로젝트 작업에도 똑같이 담긴다', async () => {
    const task = makeTodo({ id: 't1', title: '박스 사기', projectId: 'p1' })
    const h = await mountApi({ todos: [task], projects: [makeProject({ id: 'p1' })] })

    await act(async () => {
      await h.api.editTodo(byId(h.snapshot, 't1'), { place: '이케아', note: '중형 10개' })
    })

    const next = byId(h.snapshot, 't1')
    expect(next.projectId).toBe('p1')
    expect(next.place).toBe('이케아')
    expect(next.note).toBe('중형 10개')
  })
})

describe('장소와 메모 요약', () => {
  it('메모 요약은 첫 줄만 준다', () => {
    expect(todoNoteSummary(makeTodo({ note: '보험증\n둘째 줄\n셋째 줄' }))).toBe('보험증')
  })

  it('앞의 빈 줄은 건너뛴다', () => {
    expect(todoNoteSummary(makeTodo({ note: '\n   \n실제 내용' }))).toBe('실제 내용')
  })

  it('아주 긴 첫 줄은 잘라서 준다', () => {
    const long = 'ㄱ'.repeat(120)
    expect(todoNoteSummary(makeTodo({ note: long }))).toBe(`${'ㄱ'.repeat(40)}…`)
  })

  it('메모가 없거나 공백뿐이면 요약이 비어 있다', () => {
    expect(todoNoteSummary(makeTodo())).toBe('')
    expect(todoNoteSummary(makeTodo({ note: '   \n  ' }))).toBe('')
  })

  it('프로젝트 메모와 같은 규칙을 쓴다', () => {
    const raw = '첫 줄\n둘째 줄'
    expect(todoNoteSummary(makeTodo({ note: raw }))).toBe(summarizeNote(raw))
  })

  it('장소가 없거나 공백뿐이면 빈 문자열이다', () => {
    expect(todoPlace(makeTodo())).toBe('')
    expect(todoPlace(makeTodo({ place: '   ' }))).toBe('')
    expect(todoPlace(makeTodo({ place: '강남역' }))).toBe('강남역')
  })
})

describe('두 필드가 없는 옛 자료', () => {
  it('옛 할 일을 읽어도 오류가 없다', () => {
    const old = makeTodo({ id: 't1' })
    delete (old as { place?: unknown }).place
    delete (old as { note?: unknown }).note

    expect(old.place).toBeUndefined()
    expect(old.note).toBeUndefined()
    expect(todoPlace(old)).toBe('')
    expect(todoNoteSummary(old)).toBe('')
  })

  it('옛 할 일이 담긴 화면도 그대로 뜬다', async () => {
    const old = makeTodo({ id: 't1', title: '옛 할 일' })
    delete (old as { place?: unknown }).place
    delete (old as { note?: unknown }).note

    mountScreen({ todos: [old] })

    expect(await screen.findByText('옛 할 일')).toBeTruthy()
  })

  it('두 필드가 없는 옛 백업도 읽힌다', () => {
    const old = makeTodo({ id: 't1', title: '옛 할 일' })
    delete (old as { place?: unknown }).place
    delete (old as { note?: unknown }).note

    const parsed = parseBackup(
      JSON.stringify({
        v: SCHEMA_VERSION,
        exportedAt: '2026-03-12T11:00:00.000Z',
        data: { definitions: [], records: [], todos: [old], settings: {} },
      }),
    )

    const todo = parsed.data.todos[0] as Todo
    expect(todo.title).toBe('옛 할 일')
    expect(todo.place).toBeUndefined()
    expect(todo.note).toBeUndefined()
  })

  it('옛 할 일에 장소와 메모를 나중에 붙일 수 있다', async () => {
    const old = makeTodo({ id: 't1' })
    delete (old as { place?: unknown }).place
    delete (old as { note?: unknown }).note
    const h = await mountApi({ todos: [old] })

    await act(async () => {
      await h.api.editTodo(byId(h.snapshot, 't1'), { place: '강남역', note: '보험증' })
    })

    expect(byId(h.snapshot, 't1').place).toBe('강남역')
    expect(byId(h.snapshot, 't1').note).toBe('보험증')
  })
})

describe('할 일 넣는 자리', () => {
  it('처음에는 장소와 메모 칸이 접혀 있다', async () => {
    mountScreen()

    expect(await screen.findByLabelText('할 일 제목')).toBeTruthy()
    expect(screen.queryByLabelText('장소')).toBeNull()
    expect(screen.queryByLabelText('메모')).toBeNull()
    expect(screen.getByRole('button', { name: '자세히' }).getAttribute('aria-expanded')).toBe(
      'false',
    )
  })

  it('접힌 채로 넣으면 예전과 똑같이 담긴다', async () => {
    const user = userEvent.setup()
    const h = mountScreen()

    await user.type(await screen.findByLabelText('할 일 제목'), '쓰레기 버리기')
    await user.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => expect(h.snapshot.todos).toHaveLength(1))
    const todo = first(h.snapshot)
    expect(todo.title).toBe('쓰레기 버리기')
    expect(todo.status).toBe('todo')
    expect(todo.pinned).toBe(false)
    expect(todo.dueAt).toBeUndefined()
    expect(todo.place).toBeUndefined()
    expect(todo.note).toBeUndefined()
  })

  it('자세히를 펴면 장소와 메모 칸이 나오고 다시 접으면 사라진다', async () => {
    const user = userEvent.setup()
    mountScreen()

    await user.click(await screen.findByRole('button', { name: '자세히' }))
    expect(screen.getByLabelText('장소')).toBeTruthy()
    expect(screen.getByLabelText('메모')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '자세히' }))
    expect(screen.queryByLabelText('장소')).toBeNull()
    expect(screen.queryByLabelText('메모')).toBeNull()
  })

  it('펼친 칸에 적은 장소와 메모가 담긴다', async () => {
    const user = userEvent.setup()
    const h = mountScreen()

    await user.type(await screen.findByLabelText('할 일 제목'), '치과')
    await user.click(screen.getByRole('button', { name: '자세히' }))
    await user.type(screen.getByLabelText('장소'), '강남역 3번 출구')
    await user.type(screen.getByLabelText('메모'), '보험증 챙기기')
    await user.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => expect(h.snapshot.todos).toHaveLength(1))
    const todo = first(h.snapshot)
    expect(todo.place).toBe('강남역 3번 출구')
    expect(todo.note).toBe('보험증 챙기기')
  })

  it('넣고 나면 장소와 메모 칸이 비워진다', async () => {
    const user = userEvent.setup()
    mountScreen()

    await user.type(await screen.findByLabelText('할 일 제목'), '치과')
    await user.click(screen.getByRole('button', { name: '자세히' }))
    await user.type(screen.getByLabelText('장소'), '강남역')
    await user.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() =>
      expect((screen.getByLabelText('장소') as HTMLInputElement).value).toBe(''),
    )
    expect((screen.getByLabelText('메모') as HTMLInputElement).value).toBe('')
  })

  it('담당 메모와 이름이 겹치지 않는다', async () => {
    const user = userEvent.setup()
    mountScreen({ projects: [makeProject({ id: 'p1', name: '이사 준비' })] })

    await user.click(await screen.findByRole('button', { name: /이사 준비/ }))
    expect(screen.getByLabelText('담당 메모')).toBeTruthy()
    expect(screen.queryByLabelText('메모')).toBeNull()
  })
})

describe('할 일 줄에 보여주기', () => {
  it('장소가 없으면 줄에 아무것도 그리지 않는다', async () => {
    mountScreen({ todos: [makeTodo({ id: 't1', title: '치과' })] })

    const row = (await screen.findByText('치과')).closest('li')
    expect(row).toBeTruthy()
    expect(row?.textContent).not.toContain('—')
    expect(row?.querySelector('.todo-place')).toBeNull()
    expect(row?.querySelector('.todo-note')).toBeNull()
  })

  it('장소가 있으면 줄에 보여준다', async () => {
    mountScreen({ todos: [makeTodo({ id: 't1', title: '치과', place: '강남역' })] })

    const row = (await screen.findByText('치과')).closest('li')
    expect(within(row as HTMLElement).getByText('강남역')).toBeTruthy()
  })

  it('메모는 첫 줄만 잘려 보이고 전문은 펼쳐야 보인다', async () => {
    const user = userEvent.setup()
    const long = `${'ㄱ'.repeat(120)}\n숨은 둘째 줄`
    mountScreen({ todos: [makeTodo({ id: 't1', title: '치과', note: long })] })

    const row = (await screen.findByText('치과')).closest('li') as HTMLElement
    expect(within(row).getByText(`${'ㄱ'.repeat(40)}…`)).toBeTruthy()
    expect(row.textContent?.includes('ㄱ'.repeat(41))).toBe(false)
    expect(within(row).queryByText('숨은 둘째 줄')).toBeNull()

    await user.click(screen.getByLabelText('치과 장소·메모 편집'))
    expect((screen.getByLabelText('치과 메모') as HTMLTextAreaElement).value).toBe(long)
  })

  it('줄에서 장소와 메모를 붙이고 고치고 지운다', async () => {
    const user = userEvent.setup()
    const h = mountScreen({ todos: [makeTodo({ id: 't1', title: '치과' })] })

    await user.click(await screen.findByLabelText('치과 장소·메모 편집'))
    await user.type(screen.getByLabelText('치과 장소'), '강남역')
    await user.type(screen.getByLabelText('치과 메모'), '보험증')
    await user.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(byId(h.snapshot, 't1').place).toBe('강남역'))
    expect(byId(h.snapshot, 't1').note).toBe('보험증')
    expect(await screen.findByText('강남역')).toBeTruthy()

    await user.click(screen.getByLabelText('치과 장소·메모 편집'))
    await user.clear(screen.getByLabelText('치과 장소'))
    await user.type(screen.getByLabelText('치과 장소'), '역삼역')
    await user.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(byId(h.snapshot, 't1').place).toBe('역삼역'))
    expect(screen.queryByText('강남역')).toBeNull()

    await user.click(screen.getByLabelText('치과 장소·메모 편집'))
    await user.clear(screen.getByLabelText('치과 장소'))
    await user.clear(screen.getByLabelText('치과 메모'))
    await user.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(byId(h.snapshot, 't1').place).toBeUndefined())
    expect(byId(h.snapshot, 't1').note).toBeUndefined()
    expect(screen.queryByText('역삼역')).toBeNull()
  })

  it('취소하면 적던 것을 버린다', async () => {
    const user = userEvent.setup()
    const h = mountScreen({
      todos: [makeTodo({ id: 't1', title: '치과', place: '강남역' })],
    })

    await user.click(await screen.findByLabelText('치과 장소·메모 편집'))
    await user.clear(screen.getByLabelText('치과 장소'))
    await user.type(screen.getByLabelText('치과 장소'), '엉뚱한 곳')
    await user.click(screen.getByRole('button', { name: '취소' }))

    expect(await screen.findByText('강남역')).toBeTruthy()
    expect(screen.queryByText('엉뚱한 곳')).toBeNull()
    expect(byId(h.snapshot, 't1').place).toBe('강남역')
  })

  it('장소·메모 자리는 기본으로 접혀 있다', async () => {
    mountScreen({ todos: [makeTodo({ id: 't1', title: '치과', place: '강남역' })] })

    const toggle = await screen.findByLabelText('치과 장소·메모 편집')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByLabelText('치과 장소')).toBeNull()
    expect(screen.queryByLabelText('치과 메모')).toBeNull()
  })

  it('기한 편집 자리는 그대로 남아 있다', async () => {
    mountScreen({ todos: [makeTodo({ id: 't1', title: '치과' })] })

    expect(await screen.findByLabelText('치과 기한 편집')).toBeTruthy()
    expect(screen.getByText('기한 없음')).toBeTruthy()
  })
})

describe('프로젝트 작업 줄', () => {
  const seed = {
    projects: [makeProject({ id: 'p1', name: '이사 준비' })],
    todos: [makeTodo({ id: 't1', title: '박스 사기', projectId: 'p1', status: 'doing' })],
  }

  it('작업 줄에서도 장소와 메모를 붙인다', async () => {
    const user = userEvent.setup()
    const h = mountScreen(seed)

    await user.click(await screen.findByRole('button', { name: /이사 준비/ }))
    await user.click(await screen.findByLabelText('박스 사기 장소·메모 편집'))
    await user.type(screen.getByLabelText('박스 사기 장소'), '이케아')
    await user.type(screen.getByLabelText('박스 사기 메모'), '중형 10개')
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(byId(h.snapshot, 't1').place).toBe('이케아'))
    expect(byId(h.snapshot, 't1').note).toBe('중형 10개')
    expect(await screen.findByText('이케아')).toBeTruthy()
    expect(screen.getByText('중형 10개')).toBeTruthy()
  })

  it('장소가 없는 작업 줄에는 아무것도 그리지 않는다', async () => {
    const user = userEvent.setup()
    mountScreen(seed)

    await user.click(await screen.findByRole('button', { name: /이사 준비/ }))
    const row = (await screen.findByText('박스 사기')).closest('li')
    expect(row?.querySelector('.todo-place')).toBeNull()
    expect(row?.querySelector('.todo-note')).toBeNull()
  })

  it('담당 메모와 새 메모가 같은 줄에서 헷갈리지 않는다', async () => {
    const user = userEvent.setup()
    mountScreen({
      projects: [makeProject({ id: 'p1', name: '이사 준비' })],
      todos: [
        makeTodo({
          id: 't1',
          title: '박스 사기',
          projectId: 'p1',
          assignee: '나',
          note: '중형 10개',
        }),
      ],
    })

    await user.click(await screen.findByRole('button', { name: /이사 준비/ }))
    const row = (await screen.findByText('박스 사기')).closest('li') as HTMLElement
    expect(row.querySelector('.project-assignee')?.textContent).toBe('나')
    expect(row.querySelector('.todo-note')?.textContent).toBe('중형 10개')
  })
})

describe('오늘 화면', () => {
  const todos = [
    makeTodo({
      id: 't1',
      title: '치과',
      place: '강남역',
      note: '보험증 챙기기',
      dueAt: toDueAt(TODAY, '10:00'),
    }),
  ]

  it('장소는 보여주고 메모는 보여주지 않는다', async () => {
    mountToday({ todos })

    expect(await screen.findByText('치과')).toBeTruthy()
    expect(screen.getByText('강남역')).toBeTruthy()
    expect(screen.queryByText('보험증 챙기기')).toBeNull()
  })

  it('장소가 없으면 아무것도 그리지 않는다', async () => {
    mountToday({
      todos: [makeTodo({ id: 't1', title: '치과', dueAt: toDueAt(TODAY, '10:00') })],
    })

    const row = (await screen.findByText('치과')).closest('li')
    expect(row?.querySelector('.todo-place')).toBeNull()
    expect(row?.textContent).not.toContain('—')
  })

  it('메모를 고치는 자리도 오늘 화면에는 없다', async () => {
    mountToday({ todos })

    await screen.findByText('치과')
    expect(screen.queryByLabelText('치과 장소·메모 편집')).toBeNull()
  })
})

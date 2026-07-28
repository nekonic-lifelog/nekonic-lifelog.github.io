// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RowTypes, Snapshot, Store, TableName } from '../src/data/store'
import { fixedClock } from '../src/lib/clock'
import {
  liveProjects,
  personalTodos,
  projectMeetings,
  projectProgress,
  projectTasks,
  sortedProjects,
  tasksByStatus,
} from '../src/lib/selectProjects'
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../src/lib/types'
import type { Project, Todo, TodoStatus } from '../src/lib/types'
import { AppProvider, mergeById, useApp, type AppApi } from '../src/state/app'
import { useProjects, type ProjectsApi } from '../src/state/projects'
import { Todos } from '../src/screens/Todos'
import { makeJournal, makeProject, resetIds } from './factories'

const NOW = '2026-03-12T20:00:00+09:00'
const OLD = '2026-03-01T12:00:00+09:00'

let taskSeq = 0

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  const createdAt = overrides.createdAt ?? OLD
  return {
    id: overrides.id ?? `todo-${++taskSeq}`,
    v: SCHEMA_VERSION,
    createdAt,
    deviceId: 'test-device',
    updatedAt: createdAt,
    deleted: false,
    title: '작업',
    status: 'todo',
    pinned: false,
    ...overrides,
  }
}

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
  api: ProjectsApi
  snapshot: Snapshot
}

async function mountApi(initial: Partial<Snapshot> = {}): Promise<Harness> {
  const seen: { api: ProjectsApi | null; app: AppApi | null } = { api: null, app: null }

  function Probe(): null {
    seen.api = useProjects()
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

function mountScreen(initial: Partial<Snapshot> = {}) {
  return render(
    createElement(AppProvider, {
      store: memoryStore(initial),
      clock: fixedClock(NOW),
      children: createElement(Todos),
    }),
  )
}

function todoById(snapshot: Snapshot, id: string): Todo {
  const found = snapshot.todos.find((t) => t.id === id)
  if (!found) throw new Error(`할 일 ${id}를 찾을 수 없습니다`)
  return found
}

function projectById(snapshot: Snapshot, id: string): Project {
  const found = snapshot.projects.find((p) => p.id === id)
  if (!found) throw new Error(`프로젝트 ${id}를 찾을 수 없습니다`)
  return found
}

beforeEach(() => {
  resetIds()
  taskSeq = 0
})

afterEach(cleanup)

describe('프로젝트 목록 고르기', () => {
  it('지운 프로젝트는 목록에서 빠진다', () => {
    const live = makeProject({ id: 'p1' })
    const gone = makeProject({ id: 'p2', deleted: true })
    expect(liveProjects(snap({ projects: [live, gone] })).map((p) => p.id)).toEqual(['p1'])
  })

  it('보류와 완료는 진행 아래로 내려간다', () => {
    const projects = [
      makeProject({ id: 'done', status: 'done', order: 0 }),
      makeProject({ id: 'held', status: 'held', order: 1 }),
      makeProject({ id: 'active', status: 'active', order: 2 }),
    ]
    expect(sortedProjects(snap({ projects })).map((p) => p.id)).toEqual([
      'active',
      'held',
      'done',
    ])
  })

  it('같은 등급이면 order 순이다', () => {
    const projects = [
      makeProject({ id: 'b', order: 5 }),
      makeProject({ id: 'a', order: 1 }),
      makeProject({ id: 'c', order: 9 }),
    ]
    expect(sortedProjects(snap({ projects })).map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('정렬이 원본 배열을 흔들지 않는다', () => {
    const projects = [
      makeProject({ id: 'held', status: 'held', order: 0 }),
      makeProject({ id: 'active', status: 'active', order: 1 }),
    ]
    const snapshot = snap({ projects })
    sortedProjects(snapshot)
    expect(snapshot.projects.map((p) => p.id)).toEqual(['held', 'active'])
  })
})

describe('작업 고르기', () => {
  it('프로젝트 작업만 가져온다', () => {
    const todos = [
      makeTodo({ id: 't1', projectId: 'p1' }),
      makeTodo({ id: 't2', projectId: 'p2' }),
      makeTodo({ id: 't3' }),
      makeTodo({ id: 't4', projectId: 'p1', deleted: true }),
    ]
    expect(projectTasks(snap({ todos }), 'p1').map((t) => t.id)).toEqual(['t1'])
  })

  it('개인 할 일에 프로젝트 작업이 섞이지 않는다', () => {
    const todos = [
      makeTodo({ id: 't1', projectId: 'p1' }),
      makeTodo({ id: 't2' }),
      makeTodo({ id: 't3', projectId: undefined }),
    ]
    expect(personalTodos(snap({ todos })).map((t) => t.id)).toEqual(['t2', 't3'])
  })

  it('지운 개인 할 일은 빠진다', () => {
    const todos = [makeTodo({ id: 't1' }), makeTodo({ id: 't2', deleted: true })]
    expect(personalTodos(snap({ todos })).map((t) => t.id)).toEqual(['t1'])
  })

  it('상태별 묶음은 네 상태를 전부 키로 갖는다', () => {
    const groups = tasksByStatus([])
    expect(Object.keys(groups).sort()).toEqual(['doing', 'done', 'held', 'todo'])
    for (const key of ['todo', 'doing', 'done', 'held'] as TodoStatus[]) {
      expect(groups[key]).toEqual([])
    }
  })

  it('상태별 묶음이 작업을 제자리에 넣는다', () => {
    const tasks = [
      makeTodo({ id: 'a', status: 'doing' }),
      makeTodo({ id: 'b', status: 'held' }),
      makeTodo({ id: 'c', status: 'done' }),
      makeTodo({ id: 'd', status: 'todo' }),
      makeTodo({ id: 'e', status: 'doing' }),
    ]
    const groups = tasksByStatus(tasks)
    expect(groups.doing.map((t) => t.id)).toEqual(['a', 'e'])
    expect(groups.held.map((t) => t.id)).toEqual(['b'])
    expect(groups.done.map((t) => t.id)).toEqual(['c'])
    expect(groups.todo.map((t) => t.id)).toEqual(['d'])
  })
})

describe('진행률', () => {
  const project = makeProject({ id: 'p1' })

  it('done만 센다', () => {
    const todos = [
      makeTodo({ projectId: 'p1', status: 'done' }),
      makeTodo({ projectId: 'p1', status: 'doing' }),
      makeTodo({ projectId: 'p1', status: 'held' }),
      makeTodo({ projectId: 'p1', status: 'todo' }),
    ]
    expect(projectProgress(snap({ todos, projects: [project] }), project)).toEqual({
      done: 1,
      total: 4,
      percent: 25,
    })
  })

  it('작업이 0건이면 0%이고 NaN이 아니다', () => {
    const progress = projectProgress(snap({ projects: [project] }), project)
    expect(progress).toEqual({ done: 0, total: 0, percent: 0 })
    expect(Number.isNaN(progress.percent)).toBe(false)
  })

  it('지운 작업은 진행률에서 빠진다', () => {
    const todos = [
      makeTodo({ projectId: 'p1', status: 'done' }),
      makeTodo({ projectId: 'p1', status: 'todo', deleted: true }),
      makeTodo({ projectId: 'p1', status: 'done', deleted: true }),
    ]
    expect(projectProgress(snap({ todos, projects: [project] }), project)).toEqual({
      done: 1,
      total: 1,
      percent: 100,
    })
  })

  it('다른 프로젝트의 작업은 세지 않는다', () => {
    const todos = [
      makeTodo({ projectId: 'p2', status: 'done' }),
      makeTodo({ projectId: 'p1', status: 'todo' }),
    ]
    expect(projectProgress(snap({ todos, projects: [project] }), project)).toEqual({
      done: 0,
      total: 1,
      percent: 0,
    })
  })
})

describe('연결된 회의록', () => {
  const journal = [
    makeJournal({ id: 'j1', kind: 'meeting', projectId: 'p1', at: '2026-03-02T10:00:00+09:00' }),
    makeJournal({ id: 'j2', kind: 'meeting', projectId: 'p1', at: '2026-03-09T10:00:00+09:00' }),
    makeJournal({ id: 'j3', kind: 'diary', projectId: 'p1', at: '2026-03-10T10:00:00+09:00' }),
    makeJournal({ id: 'j4', kind: 'memo', projectId: 'p1', at: '2026-03-11T10:00:00+09:00' }),
    makeJournal({ id: 'j5', kind: 'meeting', projectId: 'p2', at: '2026-03-11T10:00:00+09:00' }),
    makeJournal({
      id: 'j6',
      kind: 'meeting',
      projectId: 'p1',
      at: '2026-03-12T10:00:00+09:00',
      deleted: true,
    }),
  ]

  it('회의록만, 그 프로젝트 것만, 최신 순으로 준다', () => {
    expect(projectMeetings(snap({ journal }), 'p1').map((j) => j.id)).toEqual(['j2', 'j1'])
  })

  it('지운 회의록은 나오지 않는다', () => {
    expect(projectMeetings(snap({ journal }), 'p1').some((j) => j.id === 'j6')).toBe(false)
  })

  it('회의록이 없으면 빈 배열이다', () => {
    expect(projectMeetings(snap({ journal }), 'p9')).toEqual([])
  })
})

describe('프로젝트 만들기와 고치기', () => {
  it('order가 기존 최대값보다 하나 크다', async () => {
    const h = await mountApi()

    let first: Project | null = null
    let second: Project | null = null
    await act(async () => {
      first = await h.api.addProject({ name: '이사 준비' })
    })
    await act(async () => {
      second = await h.api.addProject({ name: '논문' })
    })

    expect(first!.order).toBe(0)
    expect(second!.order).toBe(1)
    expect(second!.status).toBe('active')
  })

  it('지운 프로젝트의 order는 최대값에 넣지 않는다', async () => {
    const h = await mountApi({
      projects: [makeProject({ id: 'p1', order: 7, deleted: true }), makeProject({ id: 'p2', order: 2 })],
    })

    let created: Project | null = null
    await act(async () => {
      created = await h.api.addProject({ name: '새 프로젝트' })
    })

    expect(created!.order).toBe(3)
  })

  it('이름과 마감일을 고칠 수 있다', async () => {
    const project = makeProject({ id: 'p1', name: '이사 준비' })
    const h = await mountApi({ projects: [project] })

    await act(async () => {
      await h.api.editProject(project, { name: '이사 마무리', dueAt: '2026-04-01T12:00:00+09:00' })
    })

    const next = projectById(h.snapshot, 'p1')
    expect(next.name).toBe('이사 마무리')
    expect(next.dueAt).toBe('2026-04-01T12:00:00+09:00')
  })

  it('순서를 바꿀 수 있다', async () => {
    const project = makeProject({ id: 'p1', order: 0 })
    const h = await mountApi({ projects: [project] })

    await act(async () => {
      await h.api.reorderProject(project, 5)
    })

    expect(projectById(h.snapshot, 'p1').order).toBe(5)
  })

  it('상태를 바꾸면 updatedAt이 올라가고 createdAt은 그대로다', async () => {
    const project = makeProject({ id: 'p1', createdAt: OLD })
    const h = await mountApi({ projects: [project] })

    await act(async () => {
      await h.api.setProjectStatus(project, 'held')
    })

    const next = projectById(h.snapshot, 'p1')
    expect(next.status).toBe('held')
    expect(next.createdAt).toBe(OLD)
    expect(Date.parse(next.updatedAt)).toBeGreaterThan(Date.parse(next.createdAt))
  })
})

describe('작업 만들기와 옮기기', () => {
  it('작업은 프로젝트에 붙고 대기 상태로 시작한다', async () => {
    const project = makeProject({ id: 'p1' })
    const h = await mountApi({ projects: [project] })

    let task: Todo | null = null
    await act(async () => {
      task = await h.api.addTask('p1', { title: '  박스 사기  ', assignee: '나' })
    })

    expect(task!.title).toBe('박스 사기')
    expect(task!.projectId).toBe('p1')
    expect(task!.status).toBe('todo')
    expect(task!.assignee).toBe('나')
    expect(task!.pinned).toBe(false)
  })

  it('작업 상태를 바꾸면 updatedAt이 올라가고 createdAt은 그대로다', async () => {
    const task = makeTodo({ id: 't1', projectId: 'p1', createdAt: OLD })
    const h = await mountApi({ todos: [task], projects: [makeProject({ id: 'p1' })] })

    await act(async () => {
      await h.api.setTaskStatus(task, 'doing')
    })

    const next = todoById(h.snapshot, 't1')
    expect(next.status).toBe('doing')
    expect(next.createdAt).toBe(OLD)
    expect(Date.parse(next.updatedAt)).toBeGreaterThan(Date.parse(next.createdAt))
  })

  it('완료로 바꾸면 doneAt이 붙고 되돌리면 사라진다', async () => {
    const task = makeTodo({ id: 't1', projectId: 'p1' })
    const h = await mountApi({ todos: [task], projects: [makeProject({ id: 'p1' })] })

    await act(async () => {
      await h.api.setTaskStatus(task, 'done')
    })
    const done = todoById(h.snapshot, 't1')
    expect(done.doneAt).toBeTruthy()

    await act(async () => {
      await h.api.setTaskStatus(done, 'todo')
    })
    expect(todoById(h.snapshot, 't1').doneAt).toBeUndefined()
  })

  it('개인 할 일을 프로젝트 작업으로 옮긴다', async () => {
    const todo = makeTodo({ id: 't1' })
    const h = await mountApi({ todos: [todo], projects: [makeProject({ id: 'p1' })] })

    await act(async () => {
      await h.api.moveTask(todo, 'p1')
    })

    expect(todoById(h.snapshot, 't1').projectId).toBe('p1')
    expect(personalTodos(h.snapshot).map((t) => t.id)).toEqual([])
    expect(projectTasks(h.snapshot, 'p1').map((t) => t.id)).toEqual(['t1'])
  })

  it('프로젝트 작업을 개인 할 일로 되돌리면 상태가 대기가 된다', async () => {
    const task = makeTodo({ id: 't1', projectId: 'p1', status: 'doing' })
    const h = await mountApi({ todos: [task], projects: [makeProject({ id: 'p1' })] })

    await act(async () => {
      await h.api.moveTask(task, undefined)
    })

    const next = todoById(h.snapshot, 't1')
    expect(next.projectId).toBeUndefined()
    expect(next.status).toBe('todo')
    expect(personalTodos(h.snapshot).map((t) => t.id)).toEqual(['t1'])
  })
})

describe('프로젝트 삭제', () => {
  const project = makeProject({ id: 'p1' })
  const seed = {
    projects: [project],
    todos: [
      makeTodo({ id: 'open', projectId: 'p1', status: 'doing' }),
      makeTodo({ id: 'waiting', projectId: 'p1', status: 'held' }),
      makeTodo({ id: 'finished', projectId: 'p1', status: 'done' }),
      makeTodo({ id: 'mine' }),
    ],
  }

  it('프로젝트는 지워지지만 물리 삭제는 아니다', async () => {
    const h = await mountApi(seed)

    await act(async () => {
      await h.api.removeProject(project)
    })

    expect(projectById(h.snapshot, 'p1').deleted).toBe(true)
    expect(liveProjects(h.snapshot)).toEqual([])
  })

  it('미완료 작업이 개인 할 일로 돌아온다', async () => {
    const h = await mountApi(seed)

    await act(async () => {
      await h.api.removeProject(project)
    })

    const personal = personalTodos(h.snapshot).map((t) => t.id).sort()
    expect(personal).toEqual(['mine', 'open', 'waiting'])
    expect(todoById(h.snapshot, 'open').status).toBe('todo')
    expect(todoById(h.snapshot, 'waiting').status).toBe('todo')
  })

  it('완료한 작업은 건드리지 않는다', async () => {
    const h = await mountApi(seed)

    await act(async () => {
      await h.api.removeProject(project)
    })

    const finished = todoById(h.snapshot, 'finished')
    expect(finished.projectId).toBe('p1')
    expect(finished.status).toBe('done')
    expect(finished.updatedAt).toBe(OLD)
  })

  it('작업을 함께 지우지 않는다', async () => {
    const h = await mountApi(seed)

    await act(async () => {
      await h.api.removeProject(project)
    })

    expect(h.snapshot.todos.filter((t) => t.deleted)).toEqual([])
    expect(h.snapshot.todos).toHaveLength(4)
  })
})

describe('할 일 화면', () => {
  it('프로젝트 카드가 이름과 진행 상황을 보여준다', async () => {
    mountScreen({
      projects: [makeProject({ id: 'p1', name: '이사 준비' })],
      todos: [
        makeTodo({ projectId: 'p1', status: 'done' }),
        makeTodo({ projectId: 'p1', status: 'todo' }),
      ],
    })

    const card = await screen.findByRole('button', { name: /이사 준비/ })
    expect(within(card).getByText('1/2')).toBeTruthy()
  })

  it('프로젝트가 없으면 안내를 보여준다', async () => {
    mountScreen()
    expect(await screen.findByText('프로젝트가 없습니다.')).toBeTruthy()
  })

  it('프로젝트 작업은 개인 할 일 목록에 나오지 않는다', async () => {
    mountScreen({
      projects: [makeProject({ id: 'p1', name: '이사 준비' })],
      todos: [makeTodo({ projectId: 'p1', title: '박스 사기' })],
    })

    expect(await screen.findByText('할 일이 없습니다.')).toBeTruthy()
    expect(screen.queryByText('박스 사기')).toBeNull()
  })

  it('개인 할 일을 넣고 완료하는 흐름이 그대로다', async () => {
    const user = userEvent.setup()
    mountScreen()

    await user.type(await screen.findByLabelText('할 일 제목'), '쓰레기 버리기')
    await user.click(screen.getByRole('button', { name: '추가' }))

    await user.click(await screen.findByRole('button', { name: '쓰레기 버리기 완료 토글' }))
    await waitFor(() => expect(screen.getByText(/완료 1건/)).toBeTruthy())
  })

  it('프로젝트 카드를 누르면 상세로 들어가고 목록으로 돌아온다', async () => {
    const user = userEvent.setup()
    mountScreen({
      projects: [makeProject({ id: 'p1', name: '이사 준비' })],
      todos: [makeTodo({ id: 't1', projectId: 'p1', title: '박스 사기', status: 'doing' })],
    })

    await user.click(await screen.findByRole('button', { name: /이사 준비/ }))
    expect(await screen.findByText('박스 사기')).toBeTruthy()
    expect(screen.getByLabelText('작업 제목')).toBeTruthy()
    expect(screen.queryByLabelText('할 일 제목')).toBeNull()

    await user.click(screen.getByRole('button', { name: '← 목록' }))
    expect(await screen.findByLabelText('할 일 제목')).toBeTruthy()
  })

  it('상세에서 작업을 추가하면 진행률이 따라 움직인다', async () => {
    const user = userEvent.setup()
    mountScreen({ projects: [makeProject({ id: 'p1', name: '이사 준비' })] })

    await user.click(await screen.findByRole('button', { name: /이사 준비/ }))
    await user.type(screen.getByLabelText('작업 제목'), '박스 사기')
    await user.click(screen.getByRole('button', { name: '작업 추가' }))

    expect(await screen.findByText('0/1 완료')).toBeTruthy()
  })

  it('기한이 없으면 알림 칩도 없다', async () => {
    mountScreen({
      projects: [makeProject({ id: 'p1', name: '이사 준비' })],
    })

    await screen.findByRole('button', { name: /이사 준비/ })
    expect(screen.queryByLabelText('알림 예정')).toBeNull()
  })

  it('기한이 있으면 알림 오프셋 칩이 붙는다', async () => {
    mountScreen({
      projects: [
        makeProject({ id: 'p1', name: '이사 준비', dueAt: '2026-03-15T12:00:00+09:00' }),
      ],
    })

    const chips = await screen.findByLabelText('알림 예정')
    for (const label of ['48h', '24h', '2h', '1h']) {
      expect(within(chips).getByText(label)).toBeTruthy()
    }
  })

  it('새 프로젝트 폼으로 프로젝트를 만든다', async () => {
    const user = userEvent.setup()
    mountScreen()

    await user.click(await screen.findByRole('button', { name: '+ 새 프로젝트' }))
    await user.type(screen.getByLabelText('프로젝트 이름'), '논문 마무리')
    await user.click(screen.getByRole('button', { name: '프로젝트 만들기' }))

    expect(await screen.findByRole('button', { name: /논문 마무리/ })).toBeTruthy()
  })
})

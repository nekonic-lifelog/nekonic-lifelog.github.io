// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RowTypes, Snapshot, Store, TableName } from '../src/data/store'
import { fixedClock } from '../src/lib/clock'
import {
  checklistProgress,
  liveProjects,
  noteSummary,
  personalTodos,
  projectChecklist,
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
  window.location.hash = ''
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
    expect(within(card).getByText('작업 1/2')).toBeTruthy()
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

    await screen.findAllByRole('button', { name: /이사 준비/ })
    expect(screen.queryByLabelText(/알림 예정/)).toBeNull()
  })

  it('기한이 있으면 알림 칩 하나가 붙고 라벨에 발송 시각이 들어간다', async () => {
    mountScreen({
      projects: [
        makeProject({ id: 'p1', name: '이사 준비', dueAt: '2026-03-15T12:00:00+09:00' }),
      ],
    })

    const chips = await screen.findAllByLabelText(/알림 예정/)
    expect(chips).toHaveLength(1)
    expect(chips[0]?.textContent).toBe('알림 4')

    const label = chips[0]?.getAttribute('aria-label') ?? ''
    for (const at of [
      '2026-03-13 12:00',
      '2026-03-14 12:00',
      '2026-03-15 10:00',
      '2026-03-15 11:00',
    ]) {
      expect(label).toContain(at)
    }
  })

  it('기한이 지난 프로젝트에는 알림 칩을 그리지 않는다', async () => {
    mountScreen({
      projects: [
        makeProject({ id: 'p1', name: '이사 준비', dueAt: '2026-03-05T12:00:00+09:00' }),
      ],
    })

    await screen.findAllByRole('button', { name: /이사 준비/ })
    expect(screen.queryByLabelText(/알림 예정/)).toBeNull()
  })

  it('완료한 프로젝트에는 알림 칩을 그리지 않는다', async () => {
    const user = userEvent.setup()
    mountScreen({
      projects: [
        makeProject({
          id: 'p1',
          name: '이사 준비',
          status: 'done',
          dueAt: '2026-03-15T12:00:00+09:00',
        }),
      ],
    })

    await user.click(await screen.findByRole('button', { name: '보류·완료 1개 펼치기' }))
    await screen.findAllByRole('button', { name: /이사 준비/ })
    expect(screen.queryByLabelText(/알림 예정/)).toBeNull()
  })

  it('보류·완료한 프로젝트는 접혀 있다가 펼치면 나온다', async () => {
    const user = userEvent.setup()
    mountScreen({
      projects: [
        makeProject({ id: 'p1', name: '이사 준비' }),
        makeProject({ id: 'p2', name: '지난 워크숍', status: 'done' }),
        makeProject({ id: 'p3', name: '멈춘 사이드', status: 'held' }),
      ],
    })

    expect(await screen.findByRole('button', { name: /이사 준비/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /지난 워크숍/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /멈춘 사이드/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: '보류·완료 2개 펼치기' }))

    expect(await screen.findByRole('button', { name: /지난 워크숍/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /멈춘 사이드/ })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '보류·완료 2개 접기' }))
    expect(screen.queryByRole('button', { name: /지난 워크숍/ })).toBeNull()
  })

  it('진행 중인 프로젝트가 없어도 접이는 남는다', async () => {
    mountScreen({
      projects: [makeProject({ id: 'p1', name: '지난 워크숍', status: 'done' })],
    })

    expect(await screen.findByRole('button', { name: '보류·완료 1개 펼치기' })).toBeTruthy()
    expect(screen.queryByText('프로젝트가 없습니다.')).toBeNull()
  })

  it('오프셋이 비면 알림 칩을 그리지 않는다', async () => {
    mountScreen({
      projects: [
        makeProject({ id: 'p1', name: '이사 준비', dueAt: '2026-03-15T12:00:00+09:00' }),
      ],
      settings: { ...DEFAULT_SETTINGS, defaultOffsets: [] },
    })

    await screen.findAllByRole('button', { name: /이사 준비/ })
    expect(screen.queryByLabelText(/알림 예정/)).toBeNull()
  })

  it('새 프로젝트 폼으로 프로젝트를 만든다', async () => {
    const user = userEvent.setup()
    mountScreen()

    await user.click(await screen.findByRole('button', { name: '+ 새 프로젝트' }))
    await user.type(screen.getByLabelText('프로젝트 이름'), '논문 마무리')
    await user.click(screen.getByRole('button', { name: '프로젝트 만들기' }))

    expect(await screen.findByRole('button', { name: /논문 마무리/ })).toBeTruthy()
  })

  it('새 프로젝트 폼은 이름과 기간만 받는다', async () => {
    const user = userEvent.setup()
    mountScreen()

    await user.click(await screen.findByRole('button', { name: '+ 새 프로젝트' }))
    expect(screen.queryByLabelText('프로젝트 메모')).toBeNull()
    expect(screen.queryByLabelText('체크리스트 항목')).toBeNull()
  })
})

describe('메모와 체크리스트 고르기', () => {
  it('체크리스트가 없으면 0/0이고 NaN이 아니다', () => {
    const progress = checklistProgress(makeProject({ id: 'p1' }))
    expect(progress).toEqual({ done: 0, total: 0 })
    expect(Number.isNaN(progress.done)).toBe(false)
    expect(Number.isNaN(progress.total)).toBe(false)
  })

  it('빈 체크리스트도 0/0이다', () => {
    expect(checklistProgress(makeProject({ id: 'p1', checklist: [] }))).toEqual({
      done: 0,
      total: 0,
    })
  })

  it('체크한 항목만 done으로 센다', () => {
    const project = makeProject({
      id: 'p1',
      checklist: [
        { id: 'c1', text: '박스', done: true },
        { id: 'c2', text: '테이프', done: false },
        { id: 'c3', text: '노끈', done: true },
      ],
    })
    expect(checklistProgress(project)).toEqual({ done: 2, total: 3 })
  })

  it('두 필드가 없는 옛 프로젝트를 읽어도 오류가 없다', () => {
    const old = makeProject({ id: 'p1' })
    expect(old.note).toBeUndefined()
    expect(old.checklist).toBeUndefined()
    expect(projectChecklist(old)).toEqual([])
    expect(checklistProgress(old)).toEqual({ done: 0, total: 0 })
    expect(noteSummary(old)).toBe('')
  })

  it('체크리스트 자리에 엉뚱한 값이 있어도 견딘다', () => {
    const broken = {
      ...makeProject({ id: 'p1' }),
      checklist: 'ㅁㄴㅇㄹ',
    } as unknown as Project
    expect(projectChecklist(broken)).toEqual([])
    expect(checklistProgress(broken)).toEqual({ done: 0, total: 0 })
  })

  it('메모 요약은 첫 줄만 준다', () => {
    const project = makeProject({ id: 'p1', note: '견적 3곳\n둘째 줄\n셋째 줄' })
    expect(noteSummary(project)).toBe('견적 3곳')
  })

  it('앞의 빈 줄은 건너뛴다', () => {
    expect(noteSummary(makeProject({ id: 'p1', note: '\n   \n실제 내용' }))).toBe('실제 내용')
  })

  it('아주 긴 첫 줄은 잘라서 준다', () => {
    const long = 'ㄱ'.repeat(120)
    const summary = noteSummary(makeProject({ id: 'p1', note: long }))
    expect(summary).toBe(`${'ㄱ'.repeat(40)}…`)
    expect(summary.length).toBeLessThan(long.length)
  })

  it('공백만 있는 메모는 요약이 비어 있다', () => {
    expect(noteSummary(makeProject({ id: 'p1', note: '   \n  ' }))).toBe('')
  })
})

describe('메모 고치기', () => {
  it('메모를 적고 고치고 지운다', async () => {
    const project = makeProject({ id: 'p1' })
    const h = await mountApi({ projects: [project] })

    await act(async () => {
      await h.api.editProject(projectById(h.snapshot, 'p1'), { note: '견적 3곳' })
    })
    expect(projectById(h.snapshot, 'p1').note).toBe('견적 3곳')

    await act(async () => {
      await h.api.editProject(projectById(h.snapshot, 'p1'), { note: '견적 5곳' })
    })
    expect(projectById(h.snapshot, 'p1').note).toBe('견적 5곳')

    await act(async () => {
      await h.api.editProject(projectById(h.snapshot, 'p1'), { note: undefined })
    })
    expect(projectById(h.snapshot, 'p1').note).toBeUndefined()
  })

  it('만들 때 공백뿐인 메모는 담기지 않는다', async () => {
    const h = await mountApi()

    let created: Project | null = null
    await act(async () => {
      created = await h.api.addProject({ name: '이사 준비', note: '   ' })
    })

    expect(created!.note).toBeUndefined()
    expect(created!.checklist).toBeUndefined()
  })
})

describe('체크리스트 고치기', () => {
  const seed = { projects: [makeProject({ id: 'p1' })] }

  async function addAll(h: Harness, texts: string[]) {
    for (const text of texts) {
      await act(async () => {
        await h.api.addChecklistItem(projectById(h.snapshot, 'p1'), text)
      })
    }
  }

  function items(h: Harness) {
    return projectChecklist(projectById(h.snapshot, 'p1'))
  }

  it('더한 순서가 유지된다', async () => {
    const h = await mountApi(seed)
    await addAll(h, ['박스', '테이프', '노끈'])

    expect(items(h).map((i) => i.text)).toEqual(['박스', '테이프', '노끈'])
    expect(items(h).every((i) => i.done === false)).toBe(true)
  })

  it('항목마다 서로 다른 id가 붙는다', async () => {
    const h = await mountApi(seed)
    await addAll(h, ['박스', '테이프'])

    const ids = items(h).map((i) => i.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((id) => typeof id === 'string' && id !== '')).toBe(true)
  })

  it('앞뒤 공백은 지워서 담는다', async () => {
    const h = await mountApi(seed)
    await addAll(h, ['  박스 사기  '])

    expect(items(h).map((i) => i.text)).toEqual(['박스 사기'])
  })

  it('빈 항목과 공백뿐인 항목은 더해지지 않는다', async () => {
    const h = await mountApi(seed)
    await addAll(h, ['', '   ', '\n\t'])

    expect(items(h)).toEqual([])
    expect(projectById(h.snapshot, 'p1').updatedAt).toBe(OLD)
  })

  it('체크를 켜고 다시 끈다', async () => {
    const h = await mountApi(seed)
    await addAll(h, ['박스', '테이프'])
    const target = items(h)[1]!.id

    await act(async () => {
      await h.api.toggleChecklistItem(projectById(h.snapshot, 'p1'), target)
    })
    expect(items(h).map((i) => i.done)).toEqual([false, true])
    expect(checklistProgress(projectById(h.snapshot, 'p1'))).toEqual({ done: 1, total: 2 })

    await act(async () => {
      await h.api.toggleChecklistItem(projectById(h.snapshot, 'p1'), target)
    })
    expect(items(h).map((i) => i.done)).toEqual([false, false])
  })

  it('항목 글을 고쳐도 자리와 체크가 그대로다', async () => {
    const h = await mountApi(seed)
    await addAll(h, ['박스', '테이프', '노끈'])
    const target = items(h)[1]!.id

    await act(async () => {
      await h.api.toggleChecklistItem(projectById(h.snapshot, 'p1'), target)
    })
    await act(async () => {
      await h.api.editChecklistItem(projectById(h.snapshot, 'p1'), target, '  청테이프  ')
    })

    expect(items(h).map((i) => i.text)).toEqual(['박스', '청테이프', '노끈'])
    expect(items(h)[1]!.done).toBe(true)
    expect(items(h)[1]!.id).toBe(target)
  })

  it('빈 글로는 고치지 않는다', async () => {
    const h = await mountApi(seed)
    await addAll(h, ['박스'])
    const target = items(h)[0]!.id
    const before = projectById(h.snapshot, 'p1').updatedAt

    await act(async () => {
      await h.api.editChecklistItem(projectById(h.snapshot, 'p1'), target, '   ')
    })

    expect(items(h).map((i) => i.text)).toEqual(['박스'])
    expect(projectById(h.snapshot, 'p1').updatedAt).toBe(before)
  })

  it('항목을 지우면 나머지 순서가 그대로다', async () => {
    const h = await mountApi(seed)
    await addAll(h, ['박스', '테이프', '노끈'])
    const target = items(h)[1]!.id

    await act(async () => {
      await h.api.removeChecklistItem(projectById(h.snapshot, 'p1'), target)
    })

    expect(items(h).map((i) => i.text)).toEqual(['박스', '노끈'])
  })

  it('없는 항목을 건드려도 아무 일이 없다', async () => {
    const h = await mountApi(seed)
    await addAll(h, ['박스'])
    const before = projectById(h.snapshot, 'p1').updatedAt

    await act(async () => {
      await h.api.toggleChecklistItem(projectById(h.snapshot, 'p1'), '없는-id')
    })
    await act(async () => {
      await h.api.removeChecklistItem(projectById(h.snapshot, 'p1'), '없는-id')
    })
    await act(async () => {
      await h.api.editChecklistItem(projectById(h.snapshot, 'p1'), '없는-id', '뭔가')
    })

    expect(items(h).map((i) => i.text)).toEqual(['박스'])
    expect(projectById(h.snapshot, 'p1').updatedAt).toBe(before)
  })

  it('체크리스트를 건드리면 updatedAt이 올라가고 createdAt은 그대로다', async () => {
    const h = await mountApi({ projects: [makeProject({ id: 'p1', createdAt: OLD })] })

    await act(async () => {
      await h.api.addChecklistItem(projectById(h.snapshot, 'p1'), '박스')
    })

    const next = projectById(h.snapshot, 'p1')
    expect(next.createdAt).toBe(OLD)
    expect(Date.parse(next.updatedAt)).toBeGreaterThan(Date.parse(next.createdAt))
  })

  it('체크리스트 항목은 todos 테이블에 들어가지 않는다', async () => {
    const h = await mountApi(seed)
    await addAll(h, ['박스', '테이프'])

    expect(h.snapshot.todos).toEqual([])
    expect(projectTasks(h.snapshot, 'p1')).toEqual([])
    expect(personalTodos(h.snapshot)).toEqual([])
    expect(projectProgress(h.snapshot, projectById(h.snapshot, 'p1'))).toEqual({
      done: 0,
      total: 0,
      percent: 0,
    })
  })

  it('두 필드가 없던 옛 프로젝트에도 항목을 더할 수 있다', async () => {
    const bare = makeProject({ id: 'p1' })
    delete (bare as { note?: unknown }).note
    delete (bare as { checklist?: unknown }).checklist
    const h = await mountApi({ projects: [bare] })

    await act(async () => {
      await h.api.addChecklistItem(projectById(h.snapshot, 'p1'), '박스')
    })

    expect(items(h).map((i) => i.text)).toEqual(['박스'])
  })
})

describe('메모와 체크리스트 화면', () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: /이사 준비/ }))
  }

  it('상세에서 메모와 체크리스트는 접혀 있다', async () => {
    const user = userEvent.setup()
    mountScreen({
      projects: [
        makeProject({
          id: 'p1',
          name: '이사 준비',
          note: '견적 3곳',
          checklist: [{ id: 'c1', text: '박스', done: false }],
        }),
      ],
    })

    await open(user)
    expect(screen.getByRole('button', { name: '메모 펼치기' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '체크리스트 펼치기' })).toBeTruthy()
    expect(screen.queryByLabelText('프로젝트 메모')).toBeNull()
    expect(screen.queryByLabelText('체크리스트 항목')).toBeNull()
    expect(screen.queryByLabelText('박스 체크 토글')).toBeNull()
  })

  it('상세에서 메모를 적고 고치고 지운다', async () => {
    const user = userEvent.setup()
    mountScreen({ projects: [makeProject({ id: 'p1', name: '이사 준비' })] })

    await open(user)
    await user.click(screen.getByRole('button', { name: '메모 펼치기' }))
    await user.type(screen.getByLabelText('프로젝트 메모'), '견적 3곳')
    await user.click(screen.getByRole('button', { name: '메모 저장' }))
    expect(await screen.findByText('견적 3곳')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '메모 펼치기' }))
    await user.clear(screen.getByLabelText('프로젝트 메모'))
    await user.type(screen.getByLabelText('프로젝트 메모'), '견적 5곳')
    await user.click(screen.getByRole('button', { name: '메모 저장' }))
    expect(await screen.findByText('견적 5곳')).toBeTruthy()
    expect(screen.queryByText('견적 3곳')).toBeNull()

    await user.click(screen.getByRole('button', { name: '메모 펼치기' }))
    await user.clear(screen.getByLabelText('프로젝트 메모'))
    await user.click(screen.getByRole('button', { name: '메모 저장' }))
    await waitFor(() => expect(screen.queryByText('견적 5곳')).toBeNull())
  })

  it('메모 취소는 적던 것을 버린다', async () => {
    const user = userEvent.setup()
    mountScreen({ projects: [makeProject({ id: 'p1', name: '이사 준비', note: '견적 3곳' })] })

    await open(user)
    await user.click(screen.getByRole('button', { name: '메모 펼치기' }))
    await user.clear(screen.getByLabelText('프로젝트 메모'))
    await user.type(screen.getByLabelText('프로젝트 메모'), '엉뚱한 글')
    await user.click(screen.getByRole('button', { name: '메모 취소' }))

    expect(await screen.findByText('견적 3곳')).toBeTruthy()
    expect(screen.queryByText('엉뚱한 글')).toBeNull()
  })

  it('상세에서 체크리스트를 더하고 체크하고 고치고 지운다', async () => {
    const user = userEvent.setup()
    mountScreen({ projects: [makeProject({ id: 'p1', name: '이사 준비' })] })

    await open(user)
    await user.click(screen.getByRole('button', { name: '체크리스트 펼치기' }))
    expect(screen.getByText('체크리스트 항목이 없습니다.')).toBeTruthy()

    await user.type(screen.getByLabelText('체크리스트 항목'), '박스 사기')
    await user.click(screen.getByRole('button', { name: '항목 추가' }))
    expect(await screen.findByText('박스 사기')).toBeTruthy()

    await user.type(screen.getByLabelText('체크리스트 항목'), '테이프 사기')
    await user.click(screen.getByRole('button', { name: '항목 추가' }))
    expect(await screen.findByText('테이프 사기')).toBeTruthy()

    await user.click(await screen.findByLabelText('박스 사기 체크 토글'))
    await waitFor(() => expect(screen.getByText('1/2')).toBeTruthy())

    await user.click(screen.getByLabelText('테이프 사기 항목 고치기'))
    await user.clear(screen.getByLabelText('테이프 사기 항목 수정'))
    await user.type(screen.getByLabelText('테이프 사기 항목 수정'), '청테이프 사기')
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByText('청테이프 사기')).toBeTruthy()

    await user.click(screen.getByLabelText('청테이프 사기 항목 삭제'))
    await waitFor(() => expect(screen.queryByText('청테이프 사기')).toBeNull())
    expect(screen.getByText('박스 사기')).toBeTruthy()
  })

  it('빈 항목은 더할 수 없다', async () => {
    const user = userEvent.setup()
    mountScreen({ projects: [makeProject({ id: 'p1', name: '이사 준비' })] })

    await open(user)
    await user.click(screen.getByRole('button', { name: '체크리스트 펼치기' }))
    await user.type(screen.getByLabelText('체크리스트 항목'), '   ')

    expect(screen.getByRole('button', { name: '항목 추가' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('체크리스트 항목이 없습니다.')).toBeTruthy()
  })

  it('카드는 메모 첫 줄과 체크리스트 숫자만 보여준다', async () => {
    mountScreen({
      projects: [
        makeProject({
          id: 'p1',
          name: '이사 준비',
          note: '견적 3곳\n둘째 줄은 감춘다\n셋째 줄도 감춘다',
          checklist: [
            { id: 'c1', text: '박스', done: true },
            { id: 'c2', text: '테이프', done: false },
            { id: 'c3', text: '노끈', done: false },
          ],
        }),
      ],
    })

    const card = await screen.findByRole('button', { name: /이사 준비/ })
    expect(within(card).getByText('견적 3곳')).toBeTruthy()
    expect(within(card).queryByText('둘째 줄은 감춘다')).toBeNull()
    expect(within(card).queryByText('셋째 줄도 감춘다')).toBeNull()
    expect(within(card).getByText('☑ 1/3')).toBeTruthy()
    for (const text of ['박스', '테이프', '노끈']) {
      expect(within(card).queryByText(text)).toBeNull()
    }
  })

  it('카드의 메모는 아주 길어도 한 줄로 잘린다', async () => {
    mountScreen({
      projects: [makeProject({ id: 'p1', name: '이사 준비', note: 'ㄱ'.repeat(200) })],
    })

    const card = await screen.findByRole('button', { name: /이사 준비/ })
    expect(within(card).getByText(`${'ㄱ'.repeat(40)}…`)).toBeTruthy()
    expect(card.textContent?.includes('ㄱ'.repeat(41))).toBe(false)
  })

  it('체크리스트가 없는 카드에는 체크 숫자를 그리지 않는다', async () => {
    mountScreen({ projects: [makeProject({ id: 'p1', name: '이사 준비' })] })

    const card = await screen.findByRole('button', { name: /이사 준비/ })
    expect(within(card).queryByText('☑ 0/0')).toBeNull()
    expect(within(card).getByText('작업 0/0')).toBeTruthy()
  })
})

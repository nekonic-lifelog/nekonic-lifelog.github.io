// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RowTypes, Snapshot, Store, TableName } from '../src/data/store'
import { fixedClock } from '../src/lib/clock'
import { toDueAt } from '../src/lib/due'
import { projectHash } from '../src/lib/router'
import { DEFAULT_SETTINGS } from '../src/lib/types'
import { AppProvider, mergeById } from '../src/state/app'
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

function moving() {
  return {
    projects: [
      makeProject({
        id: 'p1',
        name: '이사 준비',
        startAt: toDueAt('2026-03-10'),
        dueAt: toDueAt('2026-03-14'),
      }),
      makeProject({ id: 'p2', name: '논문 마무리' }),
    ],
    todos: [makeTodo({ id: 't1', title: '박스 사기', projectId: 'p1', status: 'doing' })],
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

beforeEach(() => {
  resetIds()
  window.location.hash = '#/todos'
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('프로젝트 상세 주소', () => {
  it('프로젝트 상세를 열면 주소가 바뀐다', async () => {
    const user = userEvent.setup()
    mountScreen(moving())

    await user.click(await screen.findByRole('button', { name: /이사 준비/ }))

    expect(await screen.findByLabelText('작업 제목')).toBeTruthy()
    expect(window.location.hash).toBe(projectHash('p1'))
  })

  it('그 주소로 바로 들어가면 상세가 열린다', async () => {
    window.location.hash = projectHash('p1')
    mountScreen(moving())

    expect(await screen.findByRole('heading', { name: '이사 준비' })).toBeTruthy()
    expect(await screen.findByText('박스 사기')).toBeTruthy()
    expect(screen.queryByLabelText('할 일 제목')).toBeNull()
  })

  it('새로고침해도 상세가 유지된다', async () => {
    const user = userEvent.setup()
    const first = mountScreen(moving())

    await user.click(await screen.findByRole('button', { name: /이사 준비/ }))
    await screen.findByLabelText('작업 제목')
    const kept = window.location.hash

    first.unmount()
    mountScreen(moving())

    expect(window.location.hash).toBe(kept)
    expect(await screen.findByRole('heading', { name: '이사 준비' })).toBeTruthy()
  })

  it('뒤로 가면 목록으로 돌아간다', async () => {
    const user = userEvent.setup()
    mountScreen(moving())

    await user.click(await screen.findByRole('button', { name: /이사 준비/ }))
    await screen.findByLabelText('작업 제목')

    window.history.back()

    await waitFor(() => expect(window.location.hash).toBe('#/todos'))
    expect(await screen.findByLabelText('할 일 제목')).toBeTruthy()
  })

  it('목록 버튼도 주소를 목록으로 되돌린다', async () => {
    const user = userEvent.setup()
    mountScreen(moving())

    await user.click(await screen.findByRole('button', { name: /이사 준비/ }))
    await user.click(await screen.findByRole('button', { name: '← 목록' }))

    expect(await screen.findByLabelText('할 일 제목')).toBeTruthy()
    expect(window.location.hash).toBe('#/todos')
  })

  it('알 수 없는 id면 목록을 보여주고 주소도 목록으로 되돌린다', async () => {
    window.location.hash = projectHash('없는-프로젝트')
    mountScreen(moving())

    expect(await screen.findByLabelText('할 일 제목')).toBeTruthy()
    await waitFor(() => expect(window.location.hash).toBe('#/todos'))
    expect(screen.queryByLabelText('작업 제목')).toBeNull()
  })

  it('지운 프로젝트 주소도 목록으로 되돌린다', async () => {
    window.location.hash = projectHash('p9')
    mountScreen({
      projects: [makeProject({ id: 'p9', name: '지운 것', deleted: true })],
    })

    expect(await screen.findByLabelText('할 일 제목')).toBeTruthy()
    await waitFor(() => expect(window.location.hash).toBe('#/todos'))
  })

  it('일정에서 연 프로젝트도 주소에 남는다', async () => {
    const user = userEvent.setup()
    mountScreen(moving())

    await user.click(await screen.findByRole('button', { name: /일정 보기/ }))
    await user.click(await screen.findByLabelText(/이사 준비 2026-03-10부터/))

    expect(await screen.findByLabelText('작업 제목')).toBeTruthy()
    expect(window.location.hash).toBe(projectHash('p1'))
  })

  it('상세를 지우면 목록으로 돌아가고 주소도 따라온다', async () => {
    const user = userEvent.setup()
    mountScreen(moving())

    await user.click(await screen.findByRole('button', { name: /이사 준비/ }))
    await user.click(await screen.findByRole('button', { name: '프로젝트 삭제' }))
    await user.click(await screen.findByRole('button', { name: '정말 삭제' }))

    expect(await screen.findByLabelText('할 일 제목')).toBeTruthy()
    await waitFor(() => expect(window.location.hash).toBe('#/todos'))
  })
})

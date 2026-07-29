// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RowTypes, Snapshot, Store, TableName } from '../src/data/store'
import { fixedClock } from '../src/lib/clock'
import { projectHash } from '../src/lib/router'
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

interface Screen {
  todo(id: string): Todo
}

function mountDetail(initial: Partial<Snapshot> = {}): Screen {
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
        createElement(Todos, { key: 'screen' }),
        createElement(Probe, { key: 'probe' }),
      ],
    }),
  )

  return {
    todo(id) {
      const found = seen.app?.snapshot.todos.find((t) => t.id === id)
      if (!found) throw new Error(`작업 ${id}를 찾을 수 없습니다`)
      return found
    },
  }
}

async function taskRow(): Promise<HTMLElement> {
  const title = await screen.findByText('박스 사기')
  const row = title.closest('li')
  if (!row) throw new Error('작업 줄을 찾을 수 없습니다')
  return row
}

function seed(status: Todo['status'] = 'todo') {
  return {
    projects: [makeProject({ id: 'p1', name: '이사 준비' })],
    todos: [makeTodo({ id: 't1', title: '박스 사기', projectId: 'p1', status })],
  }
}

beforeEach(() => {
  resetIds()
  window.location.hash = projectHash('p1')
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('작업 줄 — 완료는 체크 하나', () => {
  it('작업을 체크로 완료할 수 있다', async () => {
    const user = userEvent.setup()
    const view = mountDetail(seed('doing'))

    const check = await screen.findByRole('button', { name: '박스 사기 완료 토글' })
    expect(check.getAttribute('aria-pressed')).toBe('false')
    await user.click(check)

    await waitFor(() => expect(view.todo('t1').status).toBe('done'))
    expect(view.todo('t1').doneAt).toBeTruthy()
  })

  it('완료를 다시 누르면 대기로 돌아간다', async () => {
    const user = userEvent.setup()
    const view = mountDetail(seed('done'))

    await user.click(await screen.findByRole('button', { name: '완료한 작업 1건 펼치기' }))
    const check = await screen.findByRole('button', { name: '박스 사기 완료 토글' })
    expect(check.getAttribute('aria-pressed')).toBe('true')
    await user.click(check)

    await waitFor(() => expect(view.todo('t1').status).toBe('todo'))
    expect(view.todo('t1').doneAt).toBeUndefined()
  })

  it('완료 판정은 status가 done인 것 하나다', async () => {
    const user = userEvent.setup()
    mountDetail(seed('doing'))

    const check = await screen.findByRole('button', { name: '박스 사기 완료 토글' })
    expect(check.getAttribute('aria-pressed')).toBe('false')

    await user.click(await screen.findByRole('button', { name: '박스 사기 작업 메뉴' }))
    await user.click(within(await taskRow()).getByRole('button', { name: '보류' }))

    expect(
      screen.getByRole('button', { name: '박스 사기 완료 토글' }).getAttribute('aria-pressed'),
    ).toBe('false')
    expect(await screen.findByText('0/1 완료')).toBeTruthy()
  })

  it('완료하면 제목에 줄이 그어지고 완료 접이로 내려간다', async () => {
    const user = userEvent.setup()
    mountDetail(seed('todo'))

    await user.click(await screen.findByRole('button', { name: '박스 사기 완료 토글' }))
    await screen.findByRole('button', { name: '완료한 작업 1건 펼치기' })
    await user.click(screen.getByRole('button', { name: '완료한 작업 1건 펼치기' }))

    const title = await screen.findByText('박스 사기')
    expect(title.classList.contains('todo-title--done')).toBe(true)
    expect(await screen.findByText('1/1 완료')).toBeTruthy()
  })

  it('상태를 고르는 셀렉트는 줄에 없다', async () => {
    mountDetail(seed('doing'))

    await screen.findByRole('button', { name: '박스 사기 완료 토글' })
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByLabelText('박스 사기 상태')).toBeNull()
  })
})

describe('작업 줄 — 더보기', () => {
  it('더보기를 열기 전에는 진행·보류·개인으로가 줄에 없다', async () => {
    mountDetail(seed('todo'))

    const row = within(await taskRow())
    expect(row.queryByRole('button', { name: '개인으로' })).toBeNull()
    expect(row.queryByRole('button', { name: '보류' })).toBeNull()
    expect(row.queryByRole('button', { name: '진행 중' })).toBeNull()
    expect(row.queryByRole('button', { name: '대기' })).toBeNull()
  })

  it('더보기에서 진행으로 바꿀 수 있다', async () => {
    const user = userEvent.setup()
    const view = mountDetail(seed('todo'))

    await user.click(await screen.findByRole('button', { name: '박스 사기 작업 메뉴' }))
    await user.click(await screen.findByRole('button', { name: '진행 중' }))

    await waitFor(() => expect(view.todo('t1').status).toBe('doing'))
  })

  it('더보기에서 보류로 바꿀 수 있다', async () => {
    const user = userEvent.setup()
    const view = mountDetail(seed('doing'))

    await user.click(await screen.findByRole('button', { name: '박스 사기 작업 메뉴' }))
    await user.click(within(await taskRow()).getByRole('button', { name: '보류' }))

    await waitFor(() => expect(view.todo('t1').status).toBe('held'))
  })

  it('더보기에서 대기로 되돌릴 수 있다', async () => {
    const user = userEvent.setup()
    const view = mountDetail(seed('doing'))

    await user.click(await screen.findByRole('button', { name: '박스 사기 작업 메뉴' }))
    await user.click(await screen.findByRole('button', { name: '대기' }))

    await waitFor(() => expect(view.todo('t1').status).toBe('todo'))
  })

  it('더보기는 지금 상태를 눌린 것으로 알려준다', async () => {
    const user = userEvent.setup()
    mountDetail(seed('held'))

    await user.click(await screen.findByRole('button', { name: '박스 사기 작업 메뉴' }))
    const row = within(await taskRow())
    expect(row.getByRole('button', { name: '보류' }).getAttribute('aria-pressed')).toBe('true')
    expect(row.getByRole('button', { name: '대기' }).getAttribute('aria-pressed')).toBe('false')
    expect(row.getByRole('button', { name: '진행 중' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('개인 할 일로 옮기기가 더보기 안에 있다', async () => {
    const user = userEvent.setup()
    const view = mountDetail(seed('doing'))

    await user.click(await screen.findByRole('button', { name: '박스 사기 작업 메뉴' }))
    await user.click(await screen.findByRole('button', { name: '개인으로' }))

    await waitFor(() => expect(view.todo('t1').projectId).toBeUndefined())
    expect(view.todo('t1').status).toBe('todo')
  })

  it('더보기를 다시 누르면 닫힌다', async () => {
    const user = userEvent.setup()
    mountDetail(seed('todo'))

    const more = await screen.findByRole('button', { name: '박스 사기 작업 메뉴' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    await user.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    await user.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: '개인으로' })).toBeNull()
  })

  it('보류한 작업은 줄에서 보류라고 읽힌다', async () => {
    mountDetail(seed('held'))

    const row = (await screen.findByText('박스 사기')).closest('li')
    if (!row) throw new Error('줄을 찾을 수 없습니다')
    expect(within(row).getByText('보류')).toBeTruthy()
  })

  it('대기 작업에는 상태 딱지를 붙이지 않는다', async () => {
    mountDetail(seed('todo'))

    const row = (await screen.findByText('박스 사기')).closest('li')
    if (!row) throw new Error('줄을 찾을 수 없습니다')
    expect(within(row).queryByText('보류')).toBeNull()
    expect(within(row).queryByText('대기')).toBeNull()
  })
})

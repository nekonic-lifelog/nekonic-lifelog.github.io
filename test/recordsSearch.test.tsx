// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { Fragment } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IdbStore } from '../src/data/idb'
import { fixedClock } from '../src/lib/clock'
import { Records } from '../src/screens/Records'
import { AppProvider, useApp, type AppApi } from '../src/state/app'
import { useJournal, type JournalApi } from '../src/state/journal'
import { useTodos, type TodosApi } from '../src/state/todos'
import { resetIds } from './factories'

const NOW = '2026-03-12T20:00:00+09:00'

let probe: { journal: JournalApi; todos: TodosApi; app: AppApi } | null = null

function Harness() {
  probe = { journal: useJournal(), todos: useTodos(), app: useApp() }
  return null
}

const live: IdbStore[] = []

function closeAll() {
  for (const store of live) store.close()
  live.length = 0
}

beforeEach(async () => {
  resetIds()
  probe = null
  closeAll()
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('lifelog')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('deleteDatabase가 blocked 되었습니다'))
  })
})

afterEach(() => {
  cleanup()
  closeAll()
})

async function mount() {
  const store = new IdbStore()
  live.push(store)
  render(
    <AppProvider store={store} clock={fixedClock(NOW)}>
      <Fragment>
        <Harness />
        <Records />
      </Fragment>
    </AppProvider>,
  )
  await waitFor(() => expect(probe?.app.ready).toBe(true))
  return store
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  let out: T | undefined
  await act(async () => {
    out = await fn()
  })
  return out as T
}

async function seed() {
  await run(() =>
    probe!.journal.addJournal({
      kind: 'meeting',
      title: '분기 계획 회의',
      body: '내년 예산을 이야기했다.',
      at: '2026-03-10T10:00:00+09:00',
    }),
  )
  await run(() =>
    probe!.journal.addJournal({
      kind: 'memo',
      body: 'Redis 캐시를 붙이면 빨라진다.',
      at: '2026-03-11T10:00:00+09:00',
    }),
  )
  await run(() => probe!.todos.addTodo({ title: '우유 사기' }))
}

async function openSearch(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '검색' }))
  return screen.getByLabelText('검색어')
}

describe('기록 검색 한 줄', () => {
  it('검색은 기본으로 접혀 있다', async () => {
    await mount()
    expect(screen.queryByLabelText('검색어')).toBeNull()
    expect(screen.getByRole('button', { name: '검색' })).toBeTruthy()
  })

  it('펼치면 검색어 칸이 나오고 닫으면 다시 접힌다', async () => {
    const user = userEvent.setup()
    await mount()

    await openSearch(user)
    expect(screen.getByLabelText('검색어')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '검색 닫기' }))
    expect(screen.queryByLabelText('검색어')).toBeNull()
    expect(screen.getByRole('button', { name: '검색' })).toBeTruthy()
  })

  it('제목으로 찾는다', async () => {
    const user = userEvent.setup()
    await mount()
    await seed()

    await user.type(await openSearch(user), '분기')
    expect(await screen.findByText('분기 계획 회의')).toBeTruthy()
    expect(screen.queryByText('Redis 캐시를 붙이면 빨라진다.')).toBeNull()
  })

  it('본문으로 찾는다', async () => {
    const user = userEvent.setup()
    await mount()
    await seed()

    await user.type(await openSearch(user), '캐시')
    expect(await screen.findByText('Redis 캐시를 붙이면 빨라진다.')).toBeTruthy()
    expect(screen.queryByText('분기 계획 회의')).toBeNull()
  })

  it('할 일 제목으로 찾고 할 일임을 표시한다', async () => {
    const user = userEvent.setup()
    await mount()
    await seed()

    await user.type(await openSearch(user), '우유')
    expect(await screen.findByText('우유 사기')).toBeTruthy()
    expect(screen.getByText('할 일')).toBeTruthy()
  })

  it('찾은 것이 없으면 안내를 보여준다', async () => {
    const user = userEvent.setup()
    await mount()
    await seed()

    await user.type(await openSearch(user), '없는낱말')
    expect(await screen.findByText(/찾은 것이 없습니다/)).toBeTruthy()
  })

  it('검색어가 비면 원래 타임라인으로 돌아온다', async () => {
    const user = userEvent.setup()
    await mount()
    await seed()

    const input = await openSearch(user)
    await user.type(input, '분기')
    expect(screen.queryByText('Redis 캐시를 붙이면 빨라진다.')).toBeNull()

    await user.clear(input)
    expect(await screen.findByText('Redis 캐시를 붙이면 빨라진다.')).toBeTruthy()
    expect(screen.getByText('분기 계획 회의')).toBeTruthy()
  })

  it('삭제한 기록은 검색에도 나오지 않는다', async () => {
    const user = userEvent.setup()
    await mount()
    const entry = await run(() =>
      probe!.journal.addJournal({ kind: 'memo', body: '지워질 낱말' }),
    )
    await run(() => probe!.journal.removeJournal(entry))

    await user.type(await openSearch(user), '지워질')
    expect(await screen.findByText(/찾은 것이 없습니다/)).toBeTruthy()
  })

  it('찾은 기록을 누르면 편집 화면이 열린다', async () => {
    const user = userEvent.setup()
    await mount()
    await seed()

    await user.type(await openSearch(user), '분기')
    await user.click(await screen.findByRole('button', { name: /분기 계획 회의/ }))

    expect((screen.getByLabelText('제목') as HTMLInputElement).value).toBe('분기 계획 회의')
    expect((screen.getByLabelText('본문') as HTMLTextAreaElement).value).toBe(
      '내년 예산을 이야기했다.',
    )
  })
})

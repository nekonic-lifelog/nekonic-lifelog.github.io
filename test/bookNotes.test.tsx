// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { Fragment } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IdbStore } from '../src/data/idb'
import { fixedClock } from '../src/lib/clock'
import { journalByBook, journalTimeline } from '../src/lib/selectJournal'
import type { Book } from '../src/lib/types'
import { Books } from '../src/screens/Books'
import { AppProvider, useApp, type AppApi } from '../src/state/app'
import { useBooks, type BooksApi } from '../src/state/books'
import { useJournal, type JournalApi } from '../src/state/journal'
import { resetIds } from './factories'

const NOW = '2026-03-12T20:00:00+09:00'

let probe: { books: BooksApi; journal: JournalApi; app: AppApi } | null = null

function Harness() {
  probe = { books: useBooks(), journal: useJournal(), app: useApp() }
  return null
}

const state = () => probe!.app.snapshot

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
        <Books />
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

async function seedBook(title = '토지'): Promise<Book> {
  return run(() => probe!.books.addBook({ title }))
}

describe('책에 붙은 메모', () => {
  it('메모는 기본으로 접혀 있고 개수만 보여준다', async () => {
    await mount()
    const book = await seedBook()
    await run(() =>
      probe!.journal.addJournal({ kind: 'memo', body: '2장이 좋았다', bookId: book.id }),
    )

    const toggle = await screen.findByRole('button', { name: /^토지 메모 1건$/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toBe('메모 1')
    expect(screen.queryByText('2장이 좋았다')).toBeNull()
  })

  it('펼치면 그 책에 붙은 메모만 모인다', async () => {
    const user = userEvent.setup()
    await mount()
    const book = await seedBook()
    const other = await seedBook('데미안')
    await run(() =>
      probe!.journal.addJournal({ kind: 'memo', body: '토지 메모', bookId: book.id }),
    )
    await run(() =>
      probe!.journal.addJournal({ kind: 'memo', body: '데미안 메모', bookId: other.id }),
    )
    await run(() => probe!.journal.addJournal({ kind: 'memo', body: '책과 무관한 메모' }))

    await user.click(await screen.findByRole('button', { name: /^토지 메모 \d+건$/ }))

    expect(screen.getByText('토지 메모')).toBeTruthy()
    expect(screen.queryByText('데미안 메모')).toBeNull()
    expect(screen.queryByText('책과 무관한 메모')).toBeNull()
  })

  it('메모가 없으면 안내를 보여준다', async () => {
    const user = userEvent.setup()
    await mount()
    await seedBook()

    await user.click(await screen.findByRole('button', { name: /^토지 메모 \d+건$/ }))
    expect(screen.getByText(/아직 붙인 메모가 없습니다/)).toBeTruthy()
  })

  it('책 화면에서 메모를 쓰면 그 책에 붙는다', async () => {
    const user = userEvent.setup()
    await mount()
    const book = await seedBook()

    await user.click(await screen.findByRole('button', { name: /^토지 메모 \d+건$/ }))
    await user.click(screen.getByRole('button', { name: '메모 쓰기' }))
    await user.type(screen.getByLabelText('본문'), '인상 깊은 문장')
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(state().journal.length).toBe(1))
    const note = state().journal[0]!
    expect(note.bookId).toBe(book.id)
    expect(note.kind).toBe('memo')
    expect(journalByBook(state(), book.id).map((e) => e.body)).toEqual(['인상 깊은 문장'])
  })

  it('메모를 쓸 때 책을 골라 바꿀 수 있다', async () => {
    const user = userEvent.setup()
    await mount()
    await seedBook()
    const other = await seedBook('데미안')

    await user.click(await screen.findByRole('button', { name: /^토지 메모 \d+건$/ }))
    await user.click(screen.getByRole('button', { name: '메모 쓰기' }))
    await user.type(screen.getByLabelText('본문'), '옮겨 붙인 메모')
    await user.selectOptions(screen.getByLabelText('책'), other.id)
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(state().journal.length).toBe(1))
    expect(state().journal[0]!.bookId).toBe(other.id)
  })

  it('붙인 메모를 눌러 고칠 수 있다', async () => {
    const user = userEvent.setup()
    await mount()
    const book = await seedBook()
    await run(() =>
      probe!.journal.addJournal({ kind: 'memo', body: '고칠 메모', bookId: book.id }),
    )

    await user.click(await screen.findByRole('button', { name: /^토지 메모 \d+건$/ }))
    await user.click(screen.getByRole('button', { name: /고칠 메모/ }))
    expect((screen.getByLabelText('본문') as HTMLTextAreaElement).value).toBe('고칠 메모')
  })

  it('책을 지워도 메모는 사라지지 않는다', async () => {
    await mount()
    const book = await seedBook()
    const note = await run(() =>
      probe!.journal.addJournal({ kind: 'memo', body: '남아야 할 메모', bookId: book.id }),
    )

    await run(() => probe!.books.removeBook(book))

    const row = state().journal.find((e) => e.id === note.id)!
    expect(row.deleted).toBe(false)
    expect(row.bookId).toBe(book.id)
    expect(journalTimeline(state()).map((e) => e.body)).toEqual(['남아야 할 메모'])
    expect(state().books[0]!.deleted).toBe(true)
  })
})

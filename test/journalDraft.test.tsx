// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { Fragment } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IdbStore } from '../src/data/idb'
import type { JournalDraft } from '../src/data/store'
import { fixedClock, mutableClock, type Clock } from '../src/lib/clock'
import { DRAFT_SAVE_MS } from '../src/screens/JournalEdit'
import { Records } from '../src/screens/Records'
import { AppProvider, useApp, type AppApi } from '../src/state/app'
import { useJournal, type JournalApi } from '../src/state/journal'
import { resetIds } from './factories'

const NOW = '2026-03-12T20:00:00+09:00'

let probe: { api: JournalApi; app: AppApi } | null = null

function Harness() {
  probe = { api: useJournal(), app: useApp() }
  return null
}

const api = () => probe!.api
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

async function mount(clock: Clock = fixedClock(NOW)) {
  const store = new IdbStore()
  live.push(store)
  render(
    <AppProvider store={store} clock={clock}>
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

function untilDraft(store: IdbStore, key: string): Promise<JournalDraft> {
  return waitFor(async () => {
    const found = await store.loadDraft(key)
    expect(found).not.toBeNull()
    return found as JournalDraft
  })
}

async function untilNoDraft(store: IdbStore, key: string) {
  await waitFor(async () => expect(await store.loadDraft(key)).toBeNull())
}

describe('일기 초안 — 쓰던 것을 지키기', () => {
  it('쓰던 중에 나갔다 들어오면 이어쓸 것을 제안한다', async () => {
    const user = userEvent.setup()
    const store = await mount()

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    await user.type(screen.getByLabelText('본문'), '길게 쓴 회의록')
    await untilDraft(store, 'new:diary')

    await user.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.queryByLabelText('본문')).toBeNull()

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    expect(await screen.findByRole('button', { name: '이어쓰기' })).toBeTruthy()
    expect(screen.getByText(/쓰다 만 글/)).toBeTruthy()
  })

  it('이어쓰기를 고르면 본문이 돌아온다', async () => {
    const user = userEvent.setup()
    const store = await mount()

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    await user.type(screen.getByLabelText('본문'), '되찾아야 할 본문')
    await untilDraft(store, 'new:diary')
    await user.click(screen.getByRole('button', { name: '취소' }))

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    await user.click(await screen.findByRole('button', { name: '이어쓰기' }))

    expect((screen.getByLabelText('본문') as HTMLTextAreaElement).value).toBe('되찾아야 할 본문')
    expect(screen.queryByRole('button', { name: '이어쓰기' })).toBeNull()
  })

  it('제목과 참석자까지 함께 돌아온다', async () => {
    const user = userEvent.setup()
    const store = await mount()

    await user.click(screen.getByRole('button', { name: '회의록 쓰기' }))
    await user.type(screen.getByLabelText('제목'), '분기 회의')
    await user.type(screen.getByLabelText('본문'), '예산 이야기')
    await user.type(screen.getByLabelText('참석자'), '김, 박')
    await untilDraft(store, 'new:meeting')
    await user.click(screen.getByRole('button', { name: '취소' }))

    await user.click(screen.getByRole('button', { name: '회의록 쓰기' }))
    await user.click(await screen.findByRole('button', { name: '이어쓰기' }))

    expect((screen.getByLabelText('제목') as HTMLInputElement).value).toBe('분기 회의')
    expect((screen.getByLabelText('본문') as HTMLTextAreaElement).value).toBe('예산 이야기')
    expect((screen.getByLabelText('참석자') as HTMLInputElement).value).toBe('김, 박')
  })

  it('버리기를 고르면 초안이 지워진다', async () => {
    const user = userEvent.setup()
    const store = await mount()

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    await user.type(screen.getByLabelText('본문'), '버릴 본문')
    await untilDraft(store, 'new:diary')
    await user.click(screen.getByRole('button', { name: '취소' }))

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    await user.click(await screen.findByRole('button', { name: '버리기' }))

    expect(screen.queryByRole('button', { name: '이어쓰기' })).toBeNull()
    expect((screen.getByLabelText('본문') as HTMLTextAreaElement).value).toBe('')
    await untilNoDraft(store, 'new:diary')
  })

  it('버린 뒤에 다시 들어오면 제안하지 않는다', async () => {
    const user = userEvent.setup()
    const store = await mount()

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    await user.type(screen.getByLabelText('본문'), '버릴 본문')
    await untilDraft(store, 'new:diary')
    await user.click(screen.getByRole('button', { name: '취소' }))

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    await user.click(await screen.findByRole('button', { name: '버리기' }))
    await user.click(screen.getByRole('button', { name: '취소' }))

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    expect(screen.queryByRole('button', { name: '이어쓰기' })).toBeNull()
  })

  it('저장을 마치면 초안이 남지 않는다', async () => {
    const user = userEvent.setup()
    const store = await mount()

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    await user.type(screen.getByLabelText('본문'), '다 쓴 본문')
    await untilDraft(store, 'new:diary')
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(state().journal.length).toBe(1))
    await untilNoDraft(store, 'new:diary')

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    expect(screen.queryByRole('button', { name: '이어쓰기' })).toBeNull()
  })

  it('초안은 journal 테이블에 들어가지 않는다', async () => {
    const user = userEvent.setup()
    const store = await mount()

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    await user.type(screen.getByLabelText('본문'), '아직-저장-안-한-본문')
    await untilDraft(store, 'new:diary')

    expect(state().journal).toEqual([])
    expect((await store.loadAll()).journal).toEqual([])
  })

  it('초안은 동기화가 보는 스냅샷에 나타나지 않는다', async () => {
    const user = userEvent.setup()
    const store = await mount()

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    await user.type(screen.getByLabelText('본문'), '동기화-금지-본문')
    await untilDraft(store, 'new:diary')

    const snapshot = await store.loadAll()
    expect(JSON.stringify(snapshot)).not.toContain('동기화-금지-본문')
    expect(JSON.stringify(state())).not.toContain('동기화-금지-본문')
  })

  it('빈 본문은 초안으로 남기지 않는다', async () => {
    const user = userEvent.setup()
    const store = await mount()

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    await user.type(screen.getByLabelText('본문'), '   ')
    await user.click(screen.getByRole('button', { name: '취소' }))

    await untilNoDraft(store, 'new:diary')
    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    expect(screen.queryByRole('button', { name: '이어쓰기' })).toBeNull()
  })

  it('쓰던 본문을 다시 비우면 남아 있던 초안도 지운다', async () => {
    const user = userEvent.setup()
    const store = await mount()

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    const body = screen.getByLabelText('본문')
    await user.type(body, '한때 쓰던 본문')
    await untilDraft(store, 'new:diary')

    await user.clear(body)
    await untilNoDraft(store, 'new:diary')
  })

  it('취소는 쓰던 것을 파기하지 않는다', async () => {
    const user = userEvent.setup()
    const store = await mount()

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    await user.type(screen.getByLabelText('본문'), '취소해도 남을 본문')
    await untilDraft(store, 'new:diary')
    await user.click(screen.getByRole('button', { name: '취소' }))

    expect((await untilDraft(store, 'new:diary')).body).toBe('취소해도 남을 본문')
  })

  it('고치던 기존 기록도 따로 초안을 남긴다', async () => {
    const user = userEvent.setup()
    const store = await mount()
    const entry = await run(() => api().addJournal({ kind: 'memo', title: '장보기', body: '우유' }))

    await user.click(await screen.findByRole('button', { name: /장보기/ }))
    await user.type(screen.getByLabelText('본문'), ' 그리고 계란')
    await untilDraft(store, `entry:${entry.id}`)
    await user.click(screen.getByRole('button', { name: '취소' }))

    await waitFor(async () =>
      expect((await store.loadDraft(`entry:${entry.id}`))?.body).toBe('우유 그리고 계란'),
    )
    expect(await store.loadDraft('new:memo')).toBeNull()
    expect(state().journal[0]!.body).toBe('우유')
  })

  it('고치던 것을 열면 원래 본문 그대로일 때는 제안하지 않는다', async () => {
    const user = userEvent.setup()
    await mount()
    await run(() => api().addJournal({ kind: 'memo', title: '장보기', body: '우유' }))

    await user.click(await screen.findByRole('button', { name: /장보기/ }))
    expect(screen.queryByRole('button', { name: '이어쓰기' })).toBeNull()
  })

  it('삭제를 마치면 그 기록의 초안도 남지 않는다', async () => {
    const user = userEvent.setup()
    const store = await mount()
    const entry = await run(() => api().addJournal({ kind: 'memo', title: '지울 메모', body: '내용' }))

    await user.click(await screen.findByRole('button', { name: /지울 메모/ }))
    await user.type(screen.getByLabelText('본문'), ' 덧붙임')
    await untilDraft(store, `entry:${entry.id}`)

    await user.click(screen.getByRole('button', { name: '삭제' }))
    await user.click(screen.getByRole('button', { name: '정말 삭제' }))

    await waitFor(() => expect(state().journal[0]!.deleted).toBe(true))
    await untilNoDraft(store, `entry:${entry.id}`)
  })
})

describe('일기 초안 — 남기는 때', () => {
  it('첫 글자를 넣자마자 한 번 남긴다', async () => {
    const user = userEvent.setup()
    const store = await mount(mutableClock(NOW))

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    await user.type(screen.getByLabelText('본문'), '가')
    expect((await untilDraft(store, 'new:diary')).body).toBe('가')
  })

  it('시계가 간격만큼 흐르기 전에는 다시 남기지 않는다', async () => {
    const user = userEvent.setup()
    const clock = mutableClock(NOW)
    const store = await mount(clock)

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    const body = screen.getByLabelText('본문')
    await user.type(body, '가')
    await untilDraft(store, 'new:diary')

    await user.type(body, '나다라')
    expect((await store.loadDraft('new:diary'))?.body).toBe('가')
  })

  it('시계가 간격만큼 흐른 뒤에 쓰면 다시 남긴다', async () => {
    const user = userEvent.setup()
    const clock = mutableClock(NOW)
    const store = await mount(clock)

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    const body = screen.getByLabelText('본문')
    await user.type(body, '가')
    await untilDraft(store, 'new:diary')

    await user.type(body, '나다라')
    act(() => clock.set(new Date(NOW).getTime() + DRAFT_SAVE_MS))
    await user.type(body, '마')

    await waitFor(async () =>
      expect((await store.loadDraft('new:diary'))?.body).toBe('가나다라마'),
    )
  })

  it('시계가 멈춰 있어도 화면을 나가면 마지막까지 남긴다', async () => {
    const user = userEvent.setup()
    const store = await mount(fixedClock(NOW))

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    await user.type(screen.getByLabelText('본문'), '한 글자씩 이어 쓴 본문')
    await user.click(screen.getByRole('button', { name: '취소' }))

    await waitFor(async () =>
      expect((await store.loadDraft('new:diary'))?.body).toBe('한 글자씩 이어 쓴 본문'),
    )
  })

  it('초안에는 남긴 시각이 함께 적힌다', async () => {
    const user = userEvent.setup()
    const store = await mount(fixedClock(NOW))

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    await user.type(screen.getByLabelText('본문'), '가')
    expect((await untilDraft(store, 'new:diary')).savedAt).toBe(new Date(NOW).toISOString())
  })
})

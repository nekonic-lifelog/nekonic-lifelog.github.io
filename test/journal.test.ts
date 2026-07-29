// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { createElement, Fragment } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IdbStore } from '../src/data/idb'
import type { Snapshot } from '../src/data/store'
import { fixedClock, mutableClock, type Clock } from '../src/lib/clock'
import {
  groupByDay,
  journalByBook,
  journalByProject,
  journalDayLabel,
  journalPreview,
  journalTimeline,
  liveJournal,
} from '../src/lib/selectJournal'
import { DEFAULT_SETTINGS, SCHEMA_VERSION, type Journal } from '../src/lib/types'
import { Records } from '../src/screens/Records'
import { AppProvider, useApp, type AppApi } from '../src/state/app'
import { useJournal, type JournalApi } from '../src/state/journal'
import { makeJournal, makeProject, resetIds } from './factories'

const NOW = '2026-03-12T20:00:00+09:00'
const TODAY = '2026-03-12'

function snap(journal: Journal[], projects: Snapshot['projects'] = []): Snapshot {
  return {
    definitions: [],
    records: [],
    todos: [],
    projects,
    books: [],
    journal,
    settings: DEFAULT_SETTINGS,
  }
}

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
    createElement(AppProvider, {
      store,
      clock,
      children: createElement(Fragment, null, createElement(Harness), createElement(Records)),
    }),
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

describe('기록 타임라인 셀렉터', () => {
  const morning = makeJournal({ id: 'a', at: '2026-03-12T09:00:00+09:00' })
  const noon = makeJournal({ id: 'b', kind: 'meeting', at: '2026-03-12T12:00:00+09:00' })
  const night = makeJournal({ id: 'c', kind: 'memo', at: '2026-03-12T22:00:00+09:00' })

  it('at 역순으로 최신이 위에 온다', () => {
    const timeline = journalTimeline(snap([morning, night, noon]))
    expect(timeline.map((e) => e.id)).toEqual(['c', 'b', 'a'])
  })

  it('같은 at이면 나중에 만든 것이 위에 온다', () => {
    const early = makeJournal({
      id: 'x',
      at: '2026-03-12T09:00:00+09:00',
      createdAt: '2026-03-12T09:00:00+09:00',
    })
    const late = makeJournal({
      id: 'y',
      at: '2026-03-12T09:00:00+09:00',
      createdAt: '2026-03-12T11:00:00+09:00',
    })
    expect(journalTimeline(snap([early, late])).map((e) => e.id)).toEqual(['y', 'x'])
    expect(journalTimeline(snap([late, early])).map((e) => e.id)).toEqual(['y', 'x'])
  })

  it('at도 createdAt도 같으면 입력 순서와 무관하게 같은 결과를 준다', () => {
    const one = makeJournal({ id: 'zzz', at: NOW, createdAt: NOW })
    const two = makeJournal({ id: 'aaa', at: NOW, createdAt: NOW })
    expect(journalTimeline(snap([one, two])).map((e) => e.id)).toEqual(
      journalTimeline(snap([two, one])).map((e) => e.id),
    )
  })

  it('kind 하나로 거를 수 있다', () => {
    expect(journalTimeline(snap([morning, noon, night]), ['meeting']).map((e) => e.id)).toEqual([
      'b',
    ])
  })

  it('kind를 여러 개 고를 수 있다', () => {
    const got = journalTimeline(snap([morning, noon, night]), ['diary', 'memo'])
    expect(got.map((e) => e.id)).toEqual(['c', 'a'])
  })

  it('필터가 없거나 비어 있으면 전부 나온다', () => {
    expect(journalTimeline(snap([morning, noon, night])).length).toBe(3)
    expect(journalTimeline(snap([morning, noon, night]), []).length).toBe(3)
  })

  it('삭제한 항목은 타임라인에도 liveJournal에도 없다', () => {
    const gone = makeJournal({ id: 'd', deleted: true, at: NOW })
    expect(liveJournal(snap([morning, gone])).map((e) => e.id)).toEqual(['a'])
    expect(journalTimeline(snap([morning, gone])).map((e) => e.id)).toEqual(['a'])
  })

  it('journalByProject는 그 프로젝트 것만 최신순으로 준다', () => {
    const p = makeProject({ id: 'p1' })
    const other = makeProject({ id: 'p2' })
    const first = makeJournal({
      id: 'm1',
      kind: 'meeting',
      projectId: p.id,
      at: '2026-03-10T10:00:00+09:00',
    })
    const second = makeJournal({
      id: 'm2',
      kind: 'meeting',
      projectId: p.id,
      at: '2026-03-11T10:00:00+09:00',
    })
    const elsewhere = makeJournal({ id: 'm3', kind: 'meeting', projectId: other.id, at: NOW })
    const dropped = makeJournal({
      id: 'm4',
      kind: 'meeting',
      projectId: p.id,
      deleted: true,
      at: NOW,
    })
    const got = journalByProject(snap([first, elsewhere, second, dropped], [p, other]), 'p1')
    expect(got.map((e) => e.id)).toEqual(['m2', 'm1'])
  })
})

describe('책에 붙는 기록', () => {
  it('bookId가 없는 옛 일기도 그대로 읽고 거른다', () => {
    const old = makeJournal({ id: 'old', body: '옛 일기' })
    expect(old.bookId).toBeUndefined()
    expect(liveJournal(snap([old])).map((e) => e.id)).toEqual(['old'])
    expect(journalTimeline(snap([old])).map((e) => e.id)).toEqual(['old'])
    expect(journalByBook(snap([old]), 'b1')).toEqual([])
  })

  it('bookId를 더해도 스키마 번호는 그대로다', () => {
    const withBook = makeJournal({ bookId: 'b1' })
    expect(withBook.v).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(1)
  })

  it('그 책에 붙은 것만 최신순으로 모은다', () => {
    const first = makeJournal({ id: 'n1', kind: 'memo', bookId: 'b1', at: '2026-03-10T10:00:00+09:00' })
    const second = makeJournal({ id: 'n2', kind: 'memo', bookId: 'b1', at: '2026-03-11T10:00:00+09:00' })
    const other = makeJournal({ id: 'n3', kind: 'memo', bookId: 'b2', at: NOW })
    const plain = makeJournal({ id: 'n4', kind: 'memo', at: NOW })
    const got = journalByBook(snap([first, other, plain, second]), 'b1')
    expect(got.map((e) => e.id)).toEqual(['n2', 'n1'])
  })

  it('삭제한 메모는 책 화면에도 오지 않는다', () => {
    const gone = makeJournal({ id: 'n9', kind: 'memo', bookId: 'b1', deleted: true })
    expect(journalByBook(snap([gone]), 'b1')).toEqual([])
  })

  it('bookId를 넣어 쓰고 고칠 수 있다', async () => {
    await mount()
    const entry = await run(() =>
      api().addJournal({ kind: 'memo', body: '인용 한 줄', bookId: 'b1' }),
    )
    expect(entry.bookId).toBe('b1')

    await run(() => api().editJournal(entry, { bookId: 'b2' }))
    expect(state().journal.find((e) => e.id === entry.id)!.bookId).toBe('b2')

    await run(() => api().editJournal(entry, { bookId: undefined }))
    expect(state().journal.find((e) => e.id === entry.id)!.bookId).toBeUndefined()
  })

  it('bookId를 주지 않으면 남기지 않는다', async () => {
    await mount()
    const entry = await run(() => api().addJournal({ kind: 'memo', body: '보통 메모' }))
    expect(entry.bookId).toBeUndefined()
  })
})

describe('본문 미리보기', () => {
  it('앞쪽 빈 줄을 건너뛰고 첫 줄만 보여준다', () => {
    const entry = makeJournal({ body: '\n  \n첫 줄이다\n둘째 줄이다' })
    expect(journalPreview(entry)).toBe('첫 줄이다')
  })

  it('긴 본문은 말줄임한다', () => {
    const entry = makeJournal({ body: '가'.repeat(80) })
    const got = journalPreview(entry)
    expect(got.endsWith('…')).toBe(true)
    expect(got.length).toBe(61)
  })

  it('max를 주면 그 길이에서 자른다', () => {
    const entry = makeJournal({ body: '가나다라마바사' })
    expect(journalPreview(entry, 3)).toBe('가나다…')
  })

  it('짧은 줄은 그대로 둔다', () => {
    expect(journalPreview(makeJournal({ body: '짧다' }), 10)).toBe('짧다')
  })

  it('공백뿐인 본문은 빈 문자열이다', () => {
    expect(journalPreview(makeJournal({ body: '\n \n\t\n' }))).toBe('')
  })
})

describe('날짜 묶기', () => {
  it('새벽 2시에 쓴 일기는 전날로 묶인다', () => {
    const dawn = makeJournal({ id: 'dawn', at: '2026-03-12T02:00:00+09:00' })
    const morning = makeJournal({ id: 'morning', at: '2026-03-12T09:00:00+09:00' })
    const groups = groupByDay(journalTimeline(snap([dawn, morning])), 4)
    expect(groups.map((g) => g.day)).toEqual(['2026-03-12', '2026-03-11'])
    expect(groups[1]!.entries.map((e) => e.id)).toEqual(['dawn'])
  })

  it('경계가 0시면 새벽 기록도 그날에 묶인다', () => {
    const dawn = makeJournal({ id: 'dawn', at: '2026-03-12T02:00:00+09:00' })
    const morning = makeJournal({ id: 'morning', at: '2026-03-12T09:00:00+09:00' })
    const groups = groupByDay(journalTimeline(snap([dawn, morning])), 0)
    expect(groups.length).toBe(1)
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(['morning', 'dawn'])
  })

  it('하루에 여러 건이면 한 묶음에 순서대로 들어간다', () => {
    const a = makeJournal({ id: 'a', at: '2026-03-12T09:00:00+09:00' })
    const b = makeJournal({ id: 'b', kind: 'meeting', at: '2026-03-12T14:00:00+09:00' })
    const c = makeJournal({ id: 'c', kind: 'memo', at: '2026-03-12T21:00:00+09:00' })
    const groups = groupByDay(journalTimeline(snap([a, b, c])), 4)
    expect(groups.length).toBe(1)
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(['c', 'b', 'a'])
  })

  it('빈 목록은 빈 묶음이다', () => {
    expect(groupByDay([], 4)).toEqual([])
  })

  it('오늘과 어제는 이름으로, 나머지는 날짜로 부른다', () => {
    expect(journalDayLabel(TODAY, TODAY)).toBe('오늘')
    expect(journalDayLabel('2026-03-11', TODAY)).toBe('어제')
    expect(journalDayLabel('2026-03-10', TODAY)).toBe('2026-03-10 (화)')
  })
})

describe('기록 쓰기와 지우기', () => {
  it('하루에 일기 2건과 회의록 1건을 써도 전부 남는다', async () => {
    await mount()
    await run(() => api().addJournal({ kind: 'diary', at: '2026-03-12T08:00:00+09:00', body: '아침' }))
    await run(() => api().addJournal({ kind: 'diary', at: '2026-03-12T22:00:00+09:00', body: '저녁' }))
    await run(() =>
      api().addJournal({
        kind: 'meeting',
        at: '2026-03-12T14:00:00+09:00',
        title: '주간 회의',
        body: '분기 계획',
      }),
    )

    const timeline = journalTimeline(state())
    expect(timeline.map((e) => e.body)).toEqual(['저녁', '분기 계획', '아침'])
    expect(groupByDay(timeline, 4).length).toBe(1)
  })

  it('at을 주지 않으면 현재 시각으로 적는다', async () => {
    await mount()
    const entry = await run(() => api().addJournal({ kind: 'memo', body: '장보기' }))
    expect(entry.at).toBe(new Date(NOW).toISOString())
  })

  it('제목과 참석자는 다듬어 저장하고, 비면 남기지 않는다', async () => {
    await mount()
    const entry = await run(() =>
      api().addJournal({
        kind: 'meeting',
        body: '내용',
        title: '  정리  ',
        attendees: [' 김 ', '', '   ', '박'],
      }),
    )
    expect(entry.title).toBe('정리')
    expect(entry.attendees).toEqual(['김', '박'])

    const bare = await run(() =>
      api().addJournal({ kind: 'memo', body: '내용', title: '   ', attendees: ['  '] }),
    )
    expect(bare.title).toBeUndefined()
    expect(bare.attendees).toBeUndefined()
  })

  it('삭제한 항목은 타임라인에 없지만 스냅샷에는 tombstone으로 남는다', async () => {
    await mount()
    const entry = await run(() => api().addJournal({ kind: 'diary', body: '지울 것' }))
    await run(() => api().removeJournal(entry))

    expect(journalTimeline(state()).length).toBe(0)
    const row = state().journal.find((e) => e.id === entry.id)
    expect(row?.deleted).toBe(true)
    expect(row?.body).toBe('지울 것')
  })

  it('편집은 updatedAt을 올리고 createdAt은 그대로 둔다', async () => {
    const clock = mutableClock(NOW)
    await mount(clock)
    const entry = await run(() => api().addJournal({ kind: 'diary', body: '처음' }))

    clock.advanceHours(3)
    await run(() => api().editJournal(entry, { body: '고침' }))

    const row = state().journal.find((e) => e.id === entry.id)!
    expect(row.body).toBe('고침')
    expect(row.createdAt).toBe(entry.createdAt)
    expect(new Date(row.updatedAt).getTime()).toBeGreaterThan(new Date(entry.updatedAt).getTime())
  })

  it('편집해도 at은 건드리지 않는다', async () => {
    const clock = mutableClock(NOW)
    await mount(clock)
    const entry = await run(() =>
      api().addJournal({ kind: 'diary', at: '2026-03-01T09:00:00+09:00', body: '처음' }),
    )
    clock.advanceHours(5)
    await run(() => api().editJournal(entry, { body: '고침' }))
    expect(state().journal.find((e) => e.id === entry.id)!.at).toBe(entry.at)
  })
})

describe('액션 아이템을 할 일로 보내기', () => {
  async function meeting(projectId?: string) {
    return run(() =>
      api().addJournal({
        kind: 'meeting',
        title: '킥오프',
        body: '내용',
        projectId,
      }),
    )
  }

  it('만들어진 todo가 회의록의 projectId를 물려받고 sourceId로 회의록을 가리킨다', async () => {
    await mount()
    const entry = await meeting('p1')
    await run(() => api().actionItemsToTodos(entry, ['견적 받기', '일정 공유']))

    const todos = state().todos
    expect(todos.map((t) => t.title)).toEqual(['견적 받기', '일정 공유'])
    for (const todo of todos) {
      expect(todo.projectId).toBe('p1')
      expect(todo.sourceId).toBe(entry.id)
      expect(todo.status).toBe('todo')
      expect(todo.deleted).toBe(false)
    }
  })

  it('빈 문자열과 공백만인 항목은 todo가 되지 않는다', async () => {
    await mount()
    const entry = await meeting('p1')
    await run(() => api().actionItemsToTodos(entry, ['', '   ', ' 진짜 할 일 ', '\n']))

    expect(state().todos.map((t) => t.title)).toEqual(['진짜 할 일'])
  })

  it('전부 비어 있으면 todo를 하나도 만들지 않는다', async () => {
    await mount()
    const entry = await meeting('p1')
    await run(() => api().actionItemsToTodos(entry, ['', '  ']))
    expect(state().todos.length).toBe(0)
  })

  it('회의록에 projectId가 없으면 만들어진 todo도 projectId가 없다', async () => {
    await mount()
    const entry = await meeting()
    await run(() => api().actionItemsToTodos(entry, ['혼자 할 일']))

    const todo = state().todos[0]!
    expect(todo.projectId).toBeUndefined()
    expect(todo.sourceId).toBe(entry.id)
  })

  it('두 번 보내면 두 벌이 쌓이고 sourceId는 같다', async () => {
    await mount()
    const entry = await meeting('p1')
    await run(() => api().actionItemsToTodos(entry, ['하나']))
    await run(() => api().actionItemsToTodos(entry, ['둘']))

    const todos = state().todos
    expect(todos.length).toBe(2)
    expect(new Set(todos.map((t) => t.sourceId))).toEqual(new Set([entry.id]))
  })
})

describe('기록 화면', () => {
  it('비어 있으면 안내를 보여준다', async () => {
    await mount()
    expect(screen.getByText(/아직 기록이 없습니다/)).toBeTruthy()
  })

  it('일기를 쓰면 타임라인에 오늘로 뜬다', async () => {
    const user = userEvent.setup()
    await mount()

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    await user.type(screen.getByLabelText('본문'), '비가 왔다')
    await user.click(screen.getByRole('button', { name: '저장' }))

    expect(await screen.findByText('오늘')).toBeTruthy()
    expect(screen.getByText('비가 왔다')).toBeTruthy()
  })

  it('일기 화면에는 제목과 프로젝트가 없고 회의록에는 있다', async () => {
    const user = userEvent.setup()
    await mount()

    await user.click(screen.getByRole('button', { name: '일기 쓰기' }))
    expect(screen.queryByLabelText('제목')).toBeNull()
    expect(screen.queryByLabelText('프로젝트')).toBeNull()
    expect(screen.queryByLabelText('참석자')).toBeNull()

    await user.click(screen.getByRole('button', { name: '취소' }))
    await user.click(screen.getByRole('button', { name: '회의록 쓰기' }))
    expect(screen.getByLabelText('제목')).toBeTruthy()
    expect(screen.getByLabelText('프로젝트')).toBeTruthy()
    expect(screen.getByLabelText('참석자')).toBeTruthy()
    expect(screen.getByRole('button', { name: '할 일로 보내기' })).toBeTruthy()
  })

  it('kind 칩으로 타임라인을 좁힌다', async () => {
    const user = userEvent.setup()
    await mount()
    await run(() => api().addJournal({ kind: 'diary', body: '일기 본문' }))
    await run(() => api().addJournal({ kind: 'memo', body: '메모 본문' }))

    expect(await screen.findByText('일기 본문')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '메모' }))
    expect(screen.queryByText('일기 본문')).toBeNull()
    expect(screen.getByText('메모 본문')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '전체' }))
    expect(screen.getByText('일기 본문')).toBeTruthy()
  })

  it('항목을 누르면 그 자리에서 편집 화면이 열린다', async () => {
    const user = userEvent.setup()
    await mount()
    await run(() => api().addJournal({ kind: 'memo', title: '장보기', body: '우유' }))

    await user.click(await screen.findByRole('button', { name: /장보기/ }))
    expect((screen.getByLabelText('본문') as HTMLTextAreaElement).value).toBe('우유')
    expect((screen.getByLabelText('제목') as HTMLInputElement).value).toBe('장보기')
  })

  it('삭제는 확인을 한 번 거친다', async () => {
    const user = userEvent.setup()
    await mount()
    await run(() => api().addJournal({ kind: 'memo', title: '지울 메모', body: '내용' }))

    await user.click(await screen.findByRole('button', { name: /지울 메모/ }))
    await user.click(screen.getByRole('button', { name: '삭제' }))
    expect(screen.getByRole('button', { name: '삭제 취소' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '정말 삭제' }))
    await waitFor(() => expect(screen.getByText(/아직 기록이 없습니다/)).toBeTruthy())
    expect(state().journal[0]!.deleted).toBe(true)
  })

  it('수정 이력 버튼은 넘겨받은 화면에서만 보인다', async () => {
    const user = userEvent.setup()
    await mount()
    await user.click(screen.getByRole('button', { name: '메모 쓰기' }))
    expect(screen.queryByRole('button', { name: '수정 이력' })).toBeNull()
  })

  it('회의록 액션 아이템을 보내면 todo가 생기고 보낸 표시가 남는다', async () => {
    const user = userEvent.setup()
    await mount()

    await user.click(screen.getByRole('button', { name: '회의록 쓰기' }))
    await user.type(screen.getByLabelText('제목'), '킥오프')
    await user.type(screen.getByLabelText('본문'), '역할 나눔')
    await user.type(screen.getByLabelText('액션 아이템'), '견적 받기')
    await user.click(screen.getByRole('button', { name: '추가' }))
    await user.click(screen.getByRole('button', { name: '할 일로 보내기' }))

    await waitFor(() => expect(state().todos.length).toBe(1))
    expect(state().todos[0]!.title).toBe('견적 받기')
    expect(screen.getByText(/할 일 1건을 보냈습니다/)).toBeTruthy()
    expect(screen.getByText('보냄')).toBeTruthy()
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import type { Snapshot } from '../src/data/store'
import { SEARCH_MAX, searchAll, searchTerms } from '../src/lib/search'
import { DEFAULT_SETTINGS, type Journal, type Todo } from '../src/lib/types'
import { makeJournal, makeTodo, resetIds } from './factories'

function snap(journal: Journal[] = [], todos: Todo[] = []): Snapshot {
  return {
    definitions: [],
    records: [],
    todos,
    projects: [],
    books: [],
    journal,
    settings: DEFAULT_SETTINGS,
  }
}

beforeEach(resetIds)

describe('검색어 다듬기', () => {
  it('앞뒤 공백을 버리고 소문자로 맞춘다', () => {
    expect(searchTerms('  Redis  ')).toEqual(['redis'])
  })

  it('사이 공백으로 낱말을 나눈다', () => {
    expect(searchTerms('분기 계획')).toEqual(['분기', '계획'])
  })

  it('공백이 여러 칸이거나 줄바꿈이어도 한 번만 나눈다', () => {
    expect(searchTerms('분기   \n 계획')).toEqual(['분기', '계획'])
  })

  it('공백뿐인 검색어는 낱말이 없다', () => {
    expect(searchTerms('   ')).toEqual([])
    expect(searchTerms('')).toEqual([])
  })
})

describe('기록 검색', () => {
  const meeting = makeJournal({
    id: 'j1',
    kind: 'meeting',
    title: '분기 계획 회의',
    body: '내년 예산을 이야기했다.',
    at: '2026-03-10T10:00:00+09:00',
  })
  const memo = makeJournal({
    id: 'j2',
    kind: 'memo',
    body: 'Redis 캐시를 붙이면 빨라진다.',
    at: '2026-03-11T10:00:00+09:00',
  })
  const chore = makeTodo({ id: 't1', title: '장보기 — 우유와 계란' })

  it('제목으로 찾는다', () => {
    const got = searchAll(snap([meeting, memo], [chore]), '분기')
    expect(got.map((h) => h.id)).toEqual(['j1'])
  })

  it('본문으로 찾는다', () => {
    const got = searchAll(snap([meeting, memo], [chore]), '예산')
    expect(got.map((h) => h.id)).toEqual(['j1'])
  })

  it('할 일 제목으로 찾는다', () => {
    const got = searchAll(snap([meeting, memo], [chore]), '우유')
    expect(got.map((h) => h.id)).toEqual(['t1'])
    expect(got[0]!.kind).toBe('todo')
  })

  it('기록과 할 일을 함께 훑는다', () => {
    const shared = makeTodo({ id: 't2', title: '분기 보고서 쓰기' })
    const got = searchAll(snap([meeting], [shared]), '분기')
    expect(got.map((h) => h.id).sort()).toEqual(['j1', 't2'])
  })

  it('대소문자를 가리지 않는다', () => {
    expect(searchAll(snap([memo]), 'redis').map((h) => h.id)).toEqual(['j2'])
    expect(searchAll(snap([memo]), 'REDIS').map((h) => h.id)).toEqual(['j2'])
  })

  it('검색어 앞뒤 공백은 무시한다', () => {
    expect(searchAll(snap([memo]), '  Redis  ').map((h) => h.id)).toEqual(['j2'])
  })

  it('낱말이 여럿이면 전부 담은 것만 찾는다', () => {
    expect(searchAll(snap([meeting]), '분기 예산').map((h) => h.id)).toEqual(['j1'])
    expect(searchAll(snap([meeting]), '분기 김치').map((h) => h.id)).toEqual([])
  })

  it('낱말은 떨어져 있어도 되고 순서를 지키지 않아도 된다', () => {
    expect(searchAll(snap([meeting]), '예산 분기').map((h) => h.id)).toEqual(['j1'])
  })

  it('빈 검색어는 아무것도 찾지 않는다', () => {
    expect(searchAll(snap([meeting, memo], [chore]), '')).toEqual([])
    expect(searchAll(snap([meeting, memo], [chore]), '   ')).toEqual([])
  })

  it('삭제한 기록은 나오지 않는다', () => {
    const gone = makeJournal({ id: 'j9', body: '지워진 예산 이야기', deleted: true })
    expect(searchAll(snap([gone]), '예산')).toEqual([])
  })

  it('삭제한 할 일은 나오지 않는다', () => {
    const gone = makeTodo({ id: 't9', title: '지워진 우유 사기', deleted: true })
    expect(searchAll(snap([], [gone]), '우유')).toEqual([])
  })

  it('최신 것이 위에 온다', () => {
    const older = makeJournal({ id: 'a', body: '같은 낱말', at: '2026-03-01T10:00:00+09:00' })
    const newer = makeJournal({ id: 'b', body: '같은 낱말', at: '2026-03-09T10:00:00+09:00' })
    expect(searchAll(snap([older, newer]), '낱말').map((h) => h.id)).toEqual(['b', 'a'])
  })

  it('at도 같으면 입력 순서와 무관하게 같은 결과를 준다', () => {
    const one = makeJournal({ id: 'zzz', body: '같은 낱말', at: '2026-03-01T10:00:00+09:00' })
    const two = makeJournal({ id: 'aaa', body: '같은 낱말', at: '2026-03-01T10:00:00+09:00' })
    expect(searchAll(snap([one, two]), '낱말').map((h) => h.id)).toEqual(
      searchAll(snap([two, one]), '낱말').map((h) => h.id),
    )
  })

  it('너무 많으면 앞에서 끊는다', () => {
    const many = Array.from({ length: SEARCH_MAX + 5 }, (_, i) =>
      makeJournal({ id: `m${i}`, body: '같은 낱말' }),
    )
    expect(searchAll(snap(many), '낱말')).toHaveLength(SEARCH_MAX)
  })

  it('max를 주면 그만큼만 준다', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      makeJournal({ id: `m${i}`, body: '같은 낱말' }),
    )
    expect(searchAll(snap(many), '낱말', 2)).toHaveLength(2)
  })
})

describe('검색 결과 한 줄', () => {
  it('찾은 낱말이 있는 줄을 보여준다', () => {
    const entry = makeJournal({
      id: 'j1',
      body: '첫 줄이다\n둘째 줄에 예산이 있다\n셋째 줄이다',
    })
    expect(searchAll(snap([entry]), '예산')[0]!.snippet).toBe('둘째 줄에 예산이 있다')
  })

  it('제목에서만 걸리면 첫 줄을 보여준다', () => {
    const entry = makeJournal({ id: 'j1', title: '분기 계획', body: '본문 첫 줄' })
    const hit = searchAll(snap([entry]), '분기')[0]!
    expect(hit.title).toBe('분기 계획')
    expect(hit.snippet).toBe('본문 첫 줄')
  })

  it('긴 줄은 말줄임한다', () => {
    const entry = makeJournal({ id: 'j1', body: `예산${'가'.repeat(200)}` })
    const snippet = searchAll(snap([entry]), '예산')[0]!.snippet
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet.length).toBeLessThanOrEqual(81)
  })

  it('할 일은 제목이 곧 한 줄이다', () => {
    const todo = makeTodo({ id: 't1', title: '우유 사기' })
    const hit = searchAll(snap([], [todo]), '우유')[0]!
    expect(hit.title).toBe('우유 사기')
    expect(hit.snippet).toBe('')
  })
})

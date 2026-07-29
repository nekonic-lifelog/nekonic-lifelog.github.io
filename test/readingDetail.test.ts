import { beforeEach, describe, expect, it } from 'vitest'
import type { Snapshot } from '../src/data/store'
import { fixedClock } from '../src/lib/clock'
import { rangeFor, readingDetail } from '../src/lib/stats'
import { DEFAULT_SETTINGS } from '../src/lib/types'
import { makeBook, makeDef, makeRecord, resetIds } from './factories'

const BOUNDARY = 4
const NOW = '2026-03-12T20:00:00+09:00'
const TODAY = '2026-03-12'
const WEEK = rangeFor('week', TODAY)

const opts = (now = NOW) => ({ boundaryHour: BOUNDARY, clock: fixedClock(now) })

function snap(partial: Partial<Snapshot> = {}): Snapshot {
  return {
    definitions: [],
    records: [],
    todos: [],
    projects: [],
    books: [],
    journal: [],
    settings: DEFAULT_SETTINGS,
    ...partial,
  }
}

function shelf() {
  const def = makeDef({ name: '토지 독서', hidden: true })
  const book = makeBook({ defId: def.id, title: '토지' })
  return { def, book }
}

beforeEach(resetIds)

describe('readingDetail — 별점 분포', () => {
  it('1점부터 5점까지 다섯 칸이다', () => {
    const { def } = shelf()
    const snapshot = snap({
      definitions: [def],
      books: [
        makeBook({ defId: def.id, title: 'ㄱ', rating: 5 }),
        makeBook({ defId: def.id, title: 'ㄴ', rating: 5 }),
        makeBook({ defId: def.id, title: 'ㄷ', rating: 3 }),
        makeBook({ defId: def.id, title: 'ㄹ', rating: 1 }),
      ],
    })
    const detail = readingDetail(snapshot, WEEK, opts())

    expect(detail.ratings).toEqual([1, 0, 1, 0, 2])
    expect(detail.rated).toBe(4)
  })

  it('rating이 없는 책은 세지 않는다', () => {
    const { def } = shelf()
    const snapshot = snap({
      definitions: [def],
      books: [
        makeBook({ defId: def.id, title: 'ㄱ', rating: 4 }),
        makeBook({ defId: def.id, title: 'ㄴ' }),
        makeBook({ defId: def.id, title: 'ㄷ' }),
      ],
    })
    const detail = readingDetail(snapshot, WEEK, opts())

    expect(detail.ratings).toEqual([0, 0, 0, 1, 0])
    expect(detail.rated).toBe(1)
  })

  it('1~5 밖의 값은 세지 않는다', () => {
    const { def } = shelf()
    const snapshot = snap({
      definitions: [def],
      books: [
        makeBook({ defId: def.id, title: 'ㄱ', rating: 0 }),
        makeBook({ defId: def.id, title: 'ㄴ', rating: 6 }),
        makeBook({ defId: def.id, title: 'ㄷ', rating: 2 }),
      ],
    })
    const detail = readingDetail(snapshot, WEEK, opts())

    expect(detail.ratings).toEqual([0, 1, 0, 0, 0])
    expect(detail.rated).toBe(1)
  })

  it('삭제된 책과 삭제된 정의의 책은 세지 않는다', () => {
    const { def } = shelf()
    const gone = makeDef({ name: '지운 것', hidden: true, deleted: true })
    const snapshot = snap({
      definitions: [def, gone],
      books: [
        makeBook({ defId: def.id, title: 'ㄱ', rating: 4 }),
        { ...makeBook({ defId: def.id, title: 'ㄴ', rating: 5 }), deleted: true },
        makeBook({ defId: gone.id, title: 'ㄷ', rating: 5 }),
      ],
    })

    expect(readingDetail(snapshot, WEEK, opts()).rated).toBe(1)
  })

  it('평균 별점은 별점이 있는 책들만으로 낸다', () => {
    const { def } = shelf()
    const snapshot = snap({
      definitions: [def],
      books: [
        makeBook({ defId: def.id, title: 'ㄱ', rating: 5 }),
        makeBook({ defId: def.id, title: 'ㄴ', rating: 2 }),
        makeBook({ defId: def.id, title: 'ㄷ' }),
      ],
    })

    expect(readingDetail(snapshot, WEEK, opts()).averageRating).toBe(3.5)
  })

  it('별점을 준 책이 없으면 평균은 0이 아니라 없음이다', () => {
    expect(readingDetail(snap(), WEEK, opts()).averageRating).toBeNull()
  })

  it('별점은 기간에 매이지 않는다 — 서가 전체를 본다', () => {
    const { def } = shelf()
    const snapshot = snap({
      definitions: [def],
      books: [
        makeBook({
          defId: def.id,
          title: 'ㄱ',
          rating: 4,
          status: 'finished',
          finishedAt: '2020-01-01T09:00:00+09:00',
        }),
      ],
    })

    expect(readingDetail(snapshot, WEEK, opts()).rated).toBe(1)
  })
})

describe('readingDetail — 하루 평균 페이지', () => {
  it('지나간 날 수로 나눈다 — 아직 오지 않은 날은 빼고 센다', () => {
    const { def, book } = shelf()
    const snapshot = snap({
      definitions: [def],
      books: [book],
      records: [
        makeRecord(def.id, '2026-03-09T21:00:00+09:00', 40),
        makeRecord(def.id, '2026-03-11T21:00:00+09:00', 60),
      ],
    })
    const detail = readingDetail(snapshot, WEEK, opts())

    expect(detail.elapsedDays).toBe(4)
    expect(detail.pagesPerDay).toBe(25)
  })

  it('다 지나간 기간은 기간 전체 날 수로 나눈다', () => {
    const { def, book } = shelf()
    const past = { from: '2026-03-02', to: '2026-03-08' }
    const snapshot = snap({
      definitions: [def],
      books: [book],
      records: [makeRecord(def.id, '2026-03-03T21:00:00+09:00', 70)],
    })
    const detail = readingDetail(snapshot, past, opts())

    expect(detail.elapsedDays).toBe(7)
    expect(detail.pagesPerDay).toBe(10)
  })

  it('읽은 것이 없으면 0쪽이다', () => {
    expect(readingDetail(snap(), WEEK, opts()).pagesPerDay).toBe(0)
  })
})

describe('readingDetail — 예상 완독일', () => {
  it('남은 쪽을 하루 평균으로 나눈 날만큼 뒤가 예상일이다', () => {
    const { def } = shelf()
    const book = makeBook({ defId: def.id, title: '토지', totalPages: 300 })
    const snapshot = snap({
      definitions: [def],
      books: [book],
      records: [
        makeRecord(def.id, '2026-03-09T21:00:00+09:00', 50),
        makeRecord(def.id, '2026-03-11T21:00:00+09:00', 50),
      ],
    })
    const pace = readingDetail(snapshot, WEEK, opts()).pace

    expect(pace).toHaveLength(1)
    expect(pace[0]!.read).toBe(100)
    expect(pace[0]!.remaining).toBe(200)
    expect(pace[0]!.perDay).toBe(25)
    expect(pace[0]!.expectedDay).toBe('2026-03-20')
  })

  it('기간 밖에 읽은 쪽도 진도에는 들어간다', () => {
    const { def } = shelf()
    const book = makeBook({ defId: def.id, title: '토지', totalPages: 300 })
    const snapshot = snap({
      definitions: [def],
      books: [book],
      records: [
        makeRecord(def.id, '2026-02-20T21:00:00+09:00', 120),
        makeRecord(def.id, '2026-03-09T21:00:00+09:00', 80),
      ],
    })
    const pace = readingDetail(snapshot, WEEK, opts()).pace

    expect(pace[0]!.read).toBe(200)
    expect(pace[0]!.remaining).toBe(100)
    expect(pace[0]!.perDay).toBe(20)
    expect(pace[0]!.expectedDay).toBe('2026-03-17')
  })

  it('이 기간에 안 읽었으면 예상일이 없다 — 아무 날이나 찍지 않는다', () => {
    const { def } = shelf()
    const book = makeBook({ defId: def.id, title: '토지', totalPages: 300 })
    const snapshot = snap({
      definitions: [def],
      books: [book],
      records: [makeRecord(def.id, '2026-02-20T21:00:00+09:00', 120)],
    })
    const pace = readingDetail(snapshot, WEEK, opts()).pace

    expect(pace[0]!.perDay).toBe(0)
    expect(pace[0]!.expectedDay).toBeNull()
  })

  it('전체 쪽수를 모르면 남은 쪽도 예상일도 없다', () => {
    const { def, book } = shelf()
    const snapshot = snap({
      definitions: [def],
      books: [book],
      records: [makeRecord(def.id, '2026-03-09T21:00:00+09:00', 50)],
    })
    const pace = readingDetail(snapshot, WEEK, opts()).pace

    expect(pace[0]!.remaining).toBeNull()
    expect(pace[0]!.expectedDay).toBeNull()
  })

  it('다 읽은 쪽수를 넘겼으면 오늘이 예상일이다', () => {
    const { def } = shelf()
    const book = makeBook({ defId: def.id, title: '토지', totalPages: 100 })
    const snapshot = snap({
      definitions: [def],
      books: [book],
      records: [makeRecord(def.id, '2026-03-09T21:00:00+09:00', 140)],
    })
    const pace = readingDetail(snapshot, WEEK, opts()).pace

    expect(pace[0]!.remaining).toBe(0)
    expect(pace[0]!.expectedDay).toBe(TODAY)
  })

  it('읽는 중인 책만 진도에 넣는다', () => {
    const { def } = shelf()
    const snapshot = snap({
      definitions: [def],
      books: [
        makeBook({ defId: def.id, title: '읽는 중', totalPages: 300 }),
        makeBook({
          defId: def.id,
          title: '다 읽음',
          totalPages: 300,
          status: 'finished',
          finishedAt: '2026-03-10T21:00:00+09:00',
        }),
        makeBook({ defId: def.id, title: '접음', totalPages: 300, status: 'dropped' }),
      ],
      records: [makeRecord(def.id, '2026-03-09T21:00:00+09:00', 50)],
    })
    const pace = readingDetail(snapshot, WEEK, opts()).pace

    expect(pace.map((p) => p.book.title)).toEqual(['읽는 중'])
  })
})

describe('readingDetail — 완독까지 걸린 일수', () => {
  it('시작한 날과 끝낸 날을 모두 넣어 센다', () => {
    const { def } = shelf()
    const snapshot = snap({
      definitions: [def],
      books: [
        makeBook({
          defId: def.id,
          title: '토지',
          status: 'finished',
          startedAt: '2026-03-01T09:00:00+09:00',
          finishedAt: '2026-03-11T22:00:00+09:00',
        }),
      ],
    })
    const finished = readingDetail(snapshot, WEEK, opts()).finished

    expect(finished).toHaveLength(1)
    expect(finished[0]!.days).toBe(11)
  })

  it('하루 만에 읽으면 1일이다', () => {
    const { def } = shelf()
    const snapshot = snap({
      definitions: [def],
      books: [
        makeBook({
          defId: def.id,
          title: '토지',
          status: 'finished',
          startedAt: '2026-03-11T09:00:00+09:00',
          finishedAt: '2026-03-11T22:00:00+09:00',
        }),
      ],
    })

    expect(readingDetail(snapshot, WEEK, opts()).finished[0]!.days).toBe(1)
  })

  it('시작한 날이 없으면 0일이 아니라 없음이다', () => {
    const { def } = shelf()
    const snapshot = snap({
      definitions: [def],
      books: [
        makeBook({
          defId: def.id,
          title: '토지',
          status: 'finished',
          finishedAt: '2026-03-11T22:00:00+09:00',
        }),
      ],
    })
    const finished = readingDetail(snapshot, WEEK, opts()).finished

    expect(finished).toHaveLength(1)
    expect(finished[0]!.days).toBeNull()
  })

  it('기간 안에 끝낸 책만 담는다', () => {
    const { def } = shelf()
    const snapshot = snap({
      definitions: [def],
      books: [
        makeBook({
          defId: def.id,
          title: '이번 주',
          status: 'finished',
          startedAt: '2026-03-01T09:00:00+09:00',
          finishedAt: '2026-03-11T22:00:00+09:00',
        }),
        makeBook({
          defId: def.id,
          title: '지난달',
          status: 'finished',
          startedAt: '2026-02-01T09:00:00+09:00',
          finishedAt: '2026-02-11T22:00:00+09:00',
        }),
      ],
    })
    const finished = readingDetail(snapshot, WEEK, opts()).finished

    expect(finished.map((f) => f.book.title)).toEqual(['이번 주'])
  })

  it('새벽에 끝낸 책은 전날 완독으로 본다', () => {
    const { def } = shelf()
    const snapshot = snap({
      definitions: [def],
      books: [
        makeBook({
          defId: def.id,
          title: '토지',
          status: 'finished',
          startedAt: '2026-03-01T09:00:00+09:00',
          finishedAt: '2026-03-09T02:00:00+09:00',
        }),
      ],
    })

    expect(readingDetail(snapshot, WEEK, opts()).finished).toHaveLength(0)
    expect(
      readingDetail(snapshot, { from: '2026-03-02', to: '2026-03-08' }, opts()).finished[0]!.days,
    ).toBe(8)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import type { RowTypes, Snapshot, TableName } from '../src/data/store'
import type { WriteCtx } from '../src/data/mutations'
import { mutableClock } from '../src/lib/clock'
import { todayKey } from '../src/lib/day'
import {
  DEFINITION_PRESETS,
  isPresetAdded,
  presetDefinitionInput,
  presetGroups,
  type DefinitionPreset,
} from '../src/lib/presets'
import { visibleDefinitions } from '../src/lib/select'
import {
  bookDefinition,
  bookProgress,
  bookSessions,
  booksByStatus,
  liveBooks,
} from '../src/lib/selectBooks'
import { dayStatus, effectiveTarget, habitView, progressPercent } from '../src/lib/streak'
import { DEFAULT_SETTINGS, type Book, type Definition } from '../src/lib/types'
import { mergeById, type AppApi } from '../src/state/app'
import { createBooksApi, PAGE_UNIT } from '../src/state/books'
import { resetIds } from './factories'

const NOW = '2026-03-12T20:00:00+09:00'
const BOUNDARY = 4
const DEVICE = 'test-device'

function harness(now: string = NOW) {
  const clock = mutableClock(now)
  let snapshot: Snapshot = {
    definitions: [],
    records: [],
    todos: [],
    projects: [],
    books: [],
    journal: [],
    settings: DEFAULT_SETTINGS,
  }
  const ctx: WriteCtx = { deviceId: DEVICE, clock }

  const app: AppApi = {
    ready: true,
    deviceId: DEVICE,
    clock,
    ctx,
    get snapshot() {
      return snapshot
    },
    get today() {
      return todayKey(clock, snapshot.settings.dayBoundaryHour)
    },
    get boundaryHour() {
      return snapshot.settings.dayBoundaryHour
    },
    async adoptDeviceId() {
      return undefined
    },
    async write<K extends TableName>(table: K, rows: RowTypes[K][]) {
      snapshot = { ...snapshot, [table]: mergeById(snapshot[table] as RowTypes[K][], rows) }
    },
    async saveSettings(patch) {
      snapshot = { ...snapshot, settings: { ...snapshot.settings, ...patch } }
    },
    async replaceAll(next) {
      snapshot = next
    },
  }

  return {
    clock,
    app,
    api: createBooksApi(app),
    snap: () => snapshot,
    fresh: (book: Book): Book => snapshot.books.find((b) => b.id === book.id) as Book,
    def: (book: Book): Definition =>
      snapshot.definitions.find((d) => d.id === book.defId) as Definition,
  }
}

const opts = (clock: { now(): number }) => ({ boundaryHour: BOUNDARY, clock })

beforeEach(resetIds)

describe('책 등록 — 전용 definition이 함께 생긴다', () => {
  it('책마다 숨은 definition이 하나 생기고 defId가 그것을 가리킨다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })

    expect(h.snap().definitions).toHaveLength(1)
    const def = h.def(book)
    expect(def.id).toBe(book.defId)
    expect(def.hidden).toBe(true)
  })

  it('숨은 definition은 습관 목록에 뜨지 않는다', async () => {
    const h = harness()
    await h.api.addBook({ title: '토지', totalPages: 320 })
    expect(visibleDefinitions(h.snap())).toHaveLength(0)
  })

  it('definition은 페이지 단위의 quantity형이다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })
    const def = h.def(book)

    expect(def.kind).toBe('quantity')
    expect(def.unit).toBe(PAGE_UNIT)
    expect(def.name).toBe('토지')
  })

  it('definition의 목표가 총 페이지와 맞물린다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })

    expect(effectiveTarget(h.def(book), '2026-03-12', BOUNDARY)).toBe(320)
  })

  it('총 페이지를 모르면 목표 없이 시작한다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '제목만 아는 책' })

    expect(h.def(book).targetHistory).toHaveLength(0)
    expect(effectiveTarget(h.def(book), '2026-03-12', BOUNDARY)).toBeNull()
    expect(h.fresh(book).totalPages).toBeUndefined()
  })

  it('등록 직후에는 읽는 중이고 읽은 페이지가 0이다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', author: '박경리', totalPages: 320 })

    expect(book.status).toBe('reading')
    expect(book.author).toBe('박경리')
    expect(bookProgress(book, h.snap()).pagesRead).toBe(0)
  })
})

describe('읽은 세션 — 도달한 페이지를 받아 차이를 쌓는다', () => {
  it('30쪽 뒤 80쪽을 적으면 기록 2건(30, 50)이 쌓이고 합계가 80이다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })

    await h.api.logProgress(book, 30)
    h.clock.advanceHours(1)
    await h.api.logProgress(book, 80)

    const sessions = bookSessions(book, h.snap())
    expect(sessions).toHaveLength(2)
    expect(sessions.map((s) => s.value)).toEqual([50, 30])
    expect(bookProgress(book, h.snap()).pagesRead).toBe(80)
  })

  it('같은 페이지를 다시 적으면 기록이 늘지 않는다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })

    await h.api.logProgress(book, 80)
    h.clock.advanceHours(1)
    await h.api.logProgress(book, 80)

    expect(bookSessions(book, h.snap())).toHaveLength(1)
    expect(bookProgress(book, h.snap()).pagesRead).toBe(80)
  })

  it('뒤로 간 페이지를 적어도 기록이 늘지 않는다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })

    await h.api.logProgress(book, 80)
    h.clock.advanceHours(1)
    await h.api.logProgress(book, 40)

    expect(bookSessions(book, h.snap())).toHaveLength(1)
    expect(bookProgress(book, h.snap()).pagesRead).toBe(80)
  })

  it('총 페이지를 넘겨 적으면 총 페이지에서 멈춘다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })

    await h.api.logProgress(book, 999)

    expect(bookProgress(book, h.snap()).pagesRead).toBe(320)
    expect(bookSessions(book, h.snap())[0]?.value).toBe(320)
  })

  it('끝까지 읽은 뒤 더 적어도 기록이 늘지 않는다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })

    await h.api.logProgress(book, 320)
    h.clock.advanceHours(1)
    await h.api.logProgress(book, 400)

    expect(bookSessions(book, h.snap())).toHaveLength(1)
  })

  it('총 페이지가 없으면 자르지 않고 그대로 쌓는다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '제목만 아는 책' })

    await h.api.logProgress(book, 120)

    expect(bookProgress(book, h.snap()).pagesRead).toBe(120)
  })

  it('메모를 붙여 기록할 수 있다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })

    await h.api.logProgress(book, 40, ' 2부 시작 ')

    expect(bookSessions(book, h.snap())[0]?.note).toBe('2부 시작')
  })

  it('숫자가 아닌 값은 무시한다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })

    await h.api.logProgress(book, Number.NaN)

    expect(bookSessions(book, h.snap())).toHaveLength(0)
  })
})

describe('진행률', () => {
  it('읽은 쪽과 총 페이지로 비율을 낸다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })
    await h.api.logProgress(book, 80)

    const progress = bookProgress(book, h.snap())
    expect(progress.pagesRead).toBe(80)
    expect(progress.totalPages).toBe(320)
    expect(progress.percent).toBeCloseTo(25)
  })

  it('100을 넘지 않는다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })
    await h.api.logProgress(book, 5000)

    expect(bookProgress(book, h.snap()).percent).toBe(100)
  })

  it('총 페이지가 없으면 진행률은 0이지만 읽은 쪽은 그대로다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '제목만 아는 책' })
    await h.api.logProgress(book, 137)

    const progress = bookProgress(book, h.snap())
    expect(progress.percent).toBe(0)
    expect(progress.totalPages).toBeNull()
    expect(progress.pagesRead).toBe(137)
  })

  it('지운 기록은 진행률에서 빠진다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })
    await h.api.logProgress(book, 30)
    h.clock.advanceHours(1)
    await h.api.logProgress(book, 80)

    await h.api.undoLastSession(book)

    expect(bookProgress(book, h.snap()).pagesRead).toBe(30)
  })

  it('다른 책의 기록이 섞이지 않는다', async () => {
    const h = harness()
    const a = await h.api.addBook({ title: '토지', totalPages: 320 })
    const b = await h.api.addBook({ title: '난쟁이가 쏘아올린 작은 공', totalPages: 200 })

    await h.api.logProgress(a, 80)
    await h.api.logProgress(b, 20)

    expect(bookProgress(a, h.snap()).pagesRead).toBe(80)
    expect(bookProgress(b, h.snap()).pagesRead).toBe(20)
  })
})

describe('총 페이지 변경 — 과거를 소급해 뒤집지 않는다', () => {
  it('목표 이력이 쌓이고 지난 날 목표는 그대로다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })
    await h.api.logProgress(book, 100)

    h.clock.advanceDays(5)
    await h.api.editBook(h.fresh(book), { totalPages: 400 })

    const def = h.def(book)
    expect(def.targetHistory).toHaveLength(2)
    expect(effectiveTarget(def, '2026-03-12', BOUNDARY)).toBe(320)
    expect(effectiveTarget(def, '2026-03-17', BOUNDARY)).toBe(400)
  })

  it('이미 쌓인 기록은 건드리지 않는다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })
    await h.api.logProgress(book, 100)

    h.clock.advanceDays(5)
    await h.api.editBook(h.fresh(book), { totalPages: 400 })

    const sessions = bookSessions(book, h.snap())
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.value).toBe(100)
    expect(bookProgress(h.fresh(book), h.snap()).pagesRead).toBe(100)
  })

  it('줄인 총 페이지가 다음 기록의 상한이 된다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })
    await h.api.logProgress(book, 100)

    h.clock.advanceDays(1)
    await h.api.editBook(h.fresh(book), { totalPages: 150 })
    await h.api.logProgress(h.fresh(book), 300)

    expect(bookProgress(h.fresh(book), h.snap()).pagesRead).toBe(150)
    expect(bookProgress(h.fresh(book), h.snap()).percent).toBe(100)
  })

  it('제목을 고치면 전용 definition의 이름도 따라간다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })

    await h.api.editBook(h.fresh(book), { title: '토지 1부' })

    expect(h.fresh(book).title).toBe('토지 1부')
    expect(h.def(book).name).toBe('토지 1부')
  })
})

describe('스트릭 엔진 재사용', () => {
  it('책 definition을 dayStatus에 그대로 먹여도 동작한다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 300 })
    await h.api.logProgress(book, 100)

    const status = dayStatus(h.def(book), h.snap().records, '2026-03-12', opts(h.clock))
    expect(status.total).toBe(100)
    expect(status.target).toBe(300)
    expect(status.achieved).toBe(false)
    expect(progressPercent(status)).toBeCloseTo(33.333, 2)
  })

  it('habitView가 최근 날짜별 읽은 쪽을 돌려준다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 300 })
    await h.api.logProgress(book, 40)

    h.clock.advanceDays(1)
    await h.api.logProgress(h.fresh(book), 90)

    const view = habitView(h.def(book), h.snap().records, opts(h.clock))
    expect(view.recent).toHaveLength(7)
    expect(view.today.day).toBe('2026-03-13')
    expect(view.today.total).toBe(50)
    expect(view.recent.find((d) => d.day === '2026-03-12')?.total).toBe(40)
  })

  it('하루 경계 앞뒤로 적은 것이 다른 날로 갈린다', async () => {
    const h = harness('2026-03-12T23:00:00+09:00')
    const book = await h.api.addBook({ title: '토지', totalPages: 300 })
    await h.api.logProgress(book, 40)

    h.clock.set('2026-03-13T02:00:00+09:00')
    await h.api.logProgress(h.fresh(book), 70)

    h.clock.set('2026-03-13T10:00:00+09:00')
    await h.api.logProgress(h.fresh(book), 100)

    const view = habitView(h.def(book), h.snap().records, opts(h.clock))
    expect(view.recent.find((d) => d.day === '2026-03-12')?.total).toBe(70)
    expect(view.recent.find((d) => d.day === '2026-03-13')?.total).toBe(30)
  })
})

describe('되돌리기', () => {
  it('마지막 세션만 되돌린다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })
    await h.api.logProgress(book, 30)
    h.clock.advanceHours(1)
    await h.api.logProgress(book, 80)
    h.clock.advanceHours(1)
    await h.api.logProgress(book, 100)

    await h.api.undoLastSession(book)

    const sessions = bookSessions(book, h.snap())
    expect(sessions.map((s) => s.value)).toEqual([50, 30])
    expect(bookProgress(book, h.snap()).pagesRead).toBe(80)
  })

  it('되돌린 뒤 같은 페이지를 다시 적으면 그 차이가 다시 쌓인다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })
    await h.api.logProgress(book, 30)
    h.clock.advanceHours(1)
    await h.api.logProgress(book, 80)

    await h.api.undoLastSession(book)
    h.clock.advanceHours(1)
    await h.api.logProgress(book, 80)

    expect(bookProgress(book, h.snap()).pagesRead).toBe(80)
    expect(bookSessions(book, h.snap())).toHaveLength(2)
  })

  it('세션이 없으면 아무 일도 없다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })

    await h.api.undoLastSession(book)

    expect(h.snap().records).toHaveLength(0)
  })
})

describe('상태와 별점', () => {
  it('완독으로 바꾸면 끝낸 시각이 채워진다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })

    await h.api.setBookStatus(h.fresh(book), 'finished')

    expect(h.fresh(book).status).toBe('finished')
    expect(h.fresh(book).finishedAt).toBe(new Date(h.clock.now()).toISOString())
  })

  it('다시 읽는 중으로 되돌리면 끝낸 시각이 지워진다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })

    await h.api.setBookStatus(h.fresh(book), 'finished')
    await h.api.setBookStatus(h.fresh(book), 'reading')

    expect(h.fresh(book).finishedAt).toBeUndefined()
  })

  it('별점은 1에서 5 사이로 잘린다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })

    await h.api.rateBook(h.fresh(book), 4)
    expect(h.fresh(book).rating).toBe(4)

    await h.api.rateBook(h.fresh(book), 9)
    expect(h.fresh(book).rating).toBe(5)

    await h.api.rateBook(h.fresh(book), 0)
    expect(h.fresh(book).rating).toBe(1)
  })

  it('상태별로 골라 볼 수 있다', async () => {
    const h = harness()
    const a = await h.api.addBook({ title: '토지', totalPages: 320 })
    const b = await h.api.addBook({ title: '광장', totalPages: 200 })
    await h.api.addBook({ title: '소년이 온다', totalPages: 216 })

    await h.api.setBookStatus(h.fresh(a), 'finished')
    await h.api.setBookStatus(h.fresh(b), 'dropped')

    expect(booksByStatus(h.snap(), 'reading').map((x) => x.title)).toEqual(['소년이 온다'])
    expect(booksByStatus(h.snap(), 'finished').map((x) => x.title)).toEqual(['토지'])
    expect(booksByStatus(h.snap(), 'dropped').map((x) => x.title)).toEqual(['광장'])
  })
})

describe('삭제 — tombstone', () => {
  it('책과 전용 definition이 함께 tombstone이 된다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })
    await h.api.logProgress(book, 80)

    await h.api.removeBook(h.fresh(book))

    expect(h.fresh(book).deleted).toBe(true)
    expect(h.def(book).deleted).toBe(true)
    expect(liveBooks(h.snap())).toHaveLength(0)
    expect(bookDefinition(book, h.snap())).toBeNull()
  })

  it('읽은 기록은 지워지지 않고 남는다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })
    await h.api.logProgress(book, 80)

    await h.api.removeBook(h.fresh(book))

    expect(h.snap().records).toHaveLength(1)
    expect(h.snap().records[0]?.deleted).toBe(false)
  })

  it('물리 삭제하지 않는다 — 행 수가 그대로다', async () => {
    const h = harness()
    const book = await h.api.addBook({ title: '토지', totalPages: 320 })

    await h.api.removeBook(h.fresh(book))

    expect(h.snap().books).toHaveLength(1)
    expect(h.snap().definitions).toHaveLength(1)
  })
})

describe('정의 프리셋', () => {
  const byKey = (key: string): DefinitionPreset =>
    DEFINITION_PRESETS.find((p) => p.key === key) as DefinitionPreset

  it('물은 하루 2000ml 목표의 수량형이다', () => {
    const water = byKey('water')
    expect(water.kind).toBe('quantity')
    expect(water.unit).toBe('ml')
    expect(water.target).toBe(2000)
    expect(water.group).toBe('음료')
  })

  it('카페인은 하루 400mg 목표의 수량형이다', () => {
    const caffeine = byKey('caffeine')
    expect(caffeine.kind).toBe('quantity')
    expect(caffeine.unit).toBe('mg')
    expect(caffeine.target).toBe(400)
  })

  it('약과 영양제와 운동은 체크형이다', () => {
    const checks = DEFINITION_PRESETS.filter((p) =>
      ['약', '영양제', '운동'].includes(p.group),
    )
    expect(checks.every((p) => p.kind === 'check')).toBe(true)
    expect(checks.map((p) => p.label)).toEqual([
      '아침 약',
      '저녁 약',
      '비타민 D',
      '오메가3',
      '마그네슘',
      '운동',
    ])
  })

  it('키가 겹치지 않는다', () => {
    const keys = DEFINITION_PRESETS.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('그룹 순서를 유지한 채 묶어준다', () => {
    expect(presetGroups().map((g) => g.group)).toEqual(['약', '영양제', '음료', '운동'])
    expect(presetGroups().find((g) => g.group === '음료')?.presets).toHaveLength(2)
  })

  it('정의 입력으로 옮기면 이름과 단위와 목표가 그대로 간다', () => {
    expect(presetDefinitionInput(byKey('water'))).toEqual({
      name: '물',
      kind: 'quantity',
      unit: 'ml',
      target: 2000,
    })
    expect(presetDefinitionInput(byKey('med-morning'))).toEqual({
      name: '아침 약',
      kind: 'check',
      unit: undefined,
      target: undefined,
    })
  })

  it('같은 이름의 정의가 이미 있으면 추가된 것으로 본다', () => {
    expect(isPresetAdded(byKey('water'), [' 물 ', '아침 약'])).toBe(true)
    expect(isPresetAdded(byKey('caffeine'), ['물'])).toBe(false)
  })
})

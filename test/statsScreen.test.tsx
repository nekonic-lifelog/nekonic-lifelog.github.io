// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Snapshot, Store } from '../src/data/store'
import { fixedClock } from '../src/lib/clock'
import { DEFAULT_SETTINGS } from '../src/lib/types'
import { Stats } from '../src/screens/Stats'
import { AppProvider } from '../src/state/app'
import { dailyRecords, makeDef, makeTodo, resetIds } from './factories'

const NOW = '2026-03-12T20:00:00+09:00'

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

function memoryStore(snapshot: Snapshot): Store {
  return {
    deviceId: async () => 'test-device',
    adoptDeviceId: async () => undefined,
    loadAll: async () => snapshot,
    put: async () => undefined,
    putSettings: async () => undefined,
    replaceAll: async () => undefined,
  }
}

function mount(snapshot: Snapshot) {
  return render(
    createElement(AppProvider, {
      store: memoryStore(snapshot),
      clock: fixedClock(NOW),
      children: createElement(Stats),
    }),
  )
}

beforeEach(resetIds)
afterEach(cleanup)

describe('통계 화면 — 기간을 앞뒤로 옮긴다', () => {
  it('지금 보고 있는 기간의 이름이 보인다', async () => {
    mount(snap())

    expect(await screen.findByText('2026-03-09 주')).toBeTruthy()
  })

  it('이전을 누르면 지난 기간으로 간다', async () => {
    const user = userEvent.setup()
    mount(snap())

    await user.click(await screen.findByRole('button', { name: '이전 기간' }))

    expect(screen.getByText('2026-03-02 주')).toBeTruthy()
  })

  it('다음을 누르면 되돌아온다', async () => {
    const user = userEvent.setup()
    mount(snap())

    await user.click(await screen.findByRole('button', { name: '이전 기간' }))
    await user.click(screen.getByRole('button', { name: '다음 기간' }))

    expect(screen.getByText('2026-03-09 주')).toBeTruthy()
  })

  it('이번 기간에서는 다음으로 갈 수 없다', async () => {
    mount(snap())

    const next = await screen.findByRole('button', { name: '다음 기간' })
    expect(next.hasAttribute('disabled')).toBe(true)
  })

  it('기간 종류를 바꾸면 이번 기간으로 돌아온다', async () => {
    const user = userEvent.setup()
    mount(snap())

    await user.click(await screen.findByRole('button', { name: '이전 기간' }))
    await user.click(screen.getByRole('button', { name: '월' }))

    expect(screen.getByText('2026-03')).toBeTruthy()
  })
})

describe('통계 화면 — 할 일 집계', () => {
  const done = (title: string, due: string, doneAt: string) =>
    makeTodo({ title, status: 'done', dueAt: due, doneAt, createdAt: '2026-03-09T09:00:00+09:00' })

  it('완료 수와 기한 준수율을 보여준다', async () => {
    mount(
      snap({
        todos: [
          done('제때', '2026-03-10T18:00:00+09:00', '2026-03-10T12:00:00+09:00'),
          done('늦게', '2026-03-10T18:00:00+09:00', '2026-03-11T12:00:00+09:00'),
        ],
      }),
    )

    const card = (await screen.findByText('할 일')).closest('.card')!
    expect(within(card as HTMLElement).getByText('2')).toBeTruthy()
    expect(within(card as HTMLElement).getByText('50%')).toBeTruthy()
  })

  it('할 일이 하나도 없으면 카드를 그리지 않는다', async () => {
    mount(snap())

    await screen.findByText('습관')
    expect(screen.queryByText('할 일')).toBeNull()
  })

  it('가장 오래 열려 있는 것을 알려준다', async () => {
    mount(
      snap({
        todos: [makeTodo({ title: '묵은 일', createdAt: '2026-02-01T09:00:00+09:00' })],
      }),
    )

    const card = (await screen.findByText('할 일')).closest('.card')!
    expect(within(card as HTMLElement).getByText(/묵은 일/)).toBeTruthy()
  })
})

describe('통계 화면 — 요일 패턴과 히트맵', () => {
  it('접힌 채로 시작한다', async () => {
    mount(snap({ definitions: [makeDef({ name: '아침 약' })] }))

    const fold = await screen.findByRole('button', { name: '요일과 한 해 보기' })
    expect(fold.getAttribute('aria-expanded')).toBe('false')
  })

  it('펼치면 요일마다 문장 설명이 붙는다', async () => {
    const user = userEvent.setup()
    const def = makeDef({ name: '아침 약', createdAt: '2026-01-01T09:00:00+09:00' })
    mount(
      snap({
        definitions: [def],
        records: dailyRecords(def.id, ['2026-03-09', '2026-03-10', '2026-03-11']),
      }),
    )

    await user.click(await screen.findByRole('button', { name: '요일과 한 해 보기' }))

    expect(screen.getByLabelText(/월요일 \d+일 중 \d+일 달성/)).toBeTruthy()
    expect(
      screen.getAllByLabelText(/요일 (\d+일 중 \d+일 달성|아직 대상 날이 없음)/),
    ).toHaveLength(7)
  })

  it('가장 무너지는 요일을 문장으로 짚어준다', async () => {
    const user = userEvent.setup()
    const def = makeDef({ name: '아침 약', createdAt: '2026-03-01T09:00:00+09:00' })
    mount(
      snap({
        definitions: [def],
        records: dailyRecords(def.id, ['2026-03-09', '2026-03-10', '2026-03-11']),
      }),
    )

    await user.click(await screen.findByRole('button', { name: '요일과 한 해 보기' }))

    expect(screen.getByText(/가장 무너지는 요일은|쌓이지 않았습니다/)).toBeTruthy()
  })

  it('아직 오지 않은 요일은 0퍼센트와 다르게 말한다', async () => {
    const user = userEvent.setup()
    const def = makeDef({ name: '아침 약', createdAt: '2026-03-09T09:00:00+09:00' })
    mount(snap({ definitions: [def], records: dailyRecords(def.id, ['2026-03-09']) }))

    await user.click(await screen.findByRole('button', { name: '요일과 한 해 보기' }))

    expect(screen.getByLabelText('금요일 아직 대상 날이 없음')).toBeTruthy()
    expect(screen.getByLabelText(/수요일 \d+일 중 0일 달성/)).toBeTruthy()
  })

  it('대상일이 없는 요일에는 막대를 그리지 않는다', async () => {
    const user = userEvent.setup()
    const def = makeDef({ name: '아침 약', createdAt: '2026-03-09T09:00:00+09:00' })
    mount(snap({ definitions: [def], records: dailyRecords(def.id, ['2026-03-09']) }))

    await user.click(await screen.findByRole('button', { name: '요일과 한 해 보기' }))

    const empty = screen.getByLabelText('금요일 아직 대상 날이 없음')
    expect(empty.querySelector('.weekday__fill')).toBeNull()

    const missed = screen.getByLabelText(/수요일 \d+일 중 0일 달성/)
    expect(missed.querySelector('.weekday__fill')).toBeNull()
  })

  it('히트맵은 제 스크롤 상자 안에 들어 있다', async () => {
    const user = userEvent.setup()
    mount(snap({ definitions: [makeDef({ name: '아침 약' })] }))

    await user.click(await screen.findByRole('button', { name: '요일과 한 해 보기' }))

    const box = document.querySelector('.heat__scroll')
    expect(box).toBeTruthy()
    expect(box!.querySelector('.heat__grid')).toBeTruthy()
  })

  it('한 해 칸 하나하나에는 설명을 달지 않는다', async () => {
    const user = userEvent.setup()
    const def = makeDef({ name: '아침 약', createdAt: '2026-01-01T09:00:00+09:00' })
    mount(snap({ definitions: [def], records: dailyRecords(def.id, ['2026-03-09']) }))

    await user.click(await screen.findByRole('button', { name: '요일과 한 해 보기' }))

    const cells = document.querySelectorAll('.heat__cell')
    expect(cells.length).toBeGreaterThan(300)
    expect(Array.from(cells).filter((c) => c.hasAttribute('aria-label'))).toHaveLength(0)
  })

  it('히트맵 전체에 한 줄 설명이 붙는다', async () => {
    const user = userEvent.setup()
    const def = makeDef({ name: '아침 약', createdAt: '2026-01-01T09:00:00+09:00' })
    mount(
      snap({
        definitions: [def],
        records: dailyRecords(def.id, ['2026-03-09', '2026-03-10']),
      }),
    )

    await user.click(await screen.findByRole('button', { name: '요일과 한 해 보기' }))

    expect(screen.getByLabelText(/아침 약.*달성/)).toBeTruthy()
  })
})

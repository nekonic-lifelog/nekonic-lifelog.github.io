// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RowTypes, Snapshot, Store, TableName } from '../src/data/store'
import { fixedClock, mutableClock, type Clock } from '../src/lib/clock'
import { DEFAULT_SETTINGS, type Definition } from '../src/lib/types'
import { AppProvider, mergeById } from '../src/state/app'
import { Today } from '../src/screens/Today'
import { scaleValues } from '../src/ui/ScaleChips'
import { dailyRecords, makeQuantityDef, makeRecord, resetIds } from './factories'

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

function mountToday(initial: Partial<Snapshot> = {}, clock: Clock = fixedClock(NOW)) {
  return render(
    <AppProvider store={memoryStore(initial)} clock={clock}>
      <Today />
    </AppProvider>,
  )
}

async function sectionOf(name: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name })
  const section = heading.closest('section')
  if (!section) throw new Error(`${name} 섹션을 찾지 못했습니다`)
  return section as HTMLElement
}

function water(): Definition {
  return makeQuantityDef([{ from: '2026-03-01T12:00:00+09:00', target: 2000 }], {
    id: 'water',
    name: '물',
    order: 0,
  })
}

function caffeine(): Definition {
  return makeQuantityDef([], {
    id: 'caffeine',
    name: '카페인',
    unit: 'mg',
    scored: false,
    order: 1,
  })
}

function mood(): Definition {
  return makeQuantityDef([], {
    id: 'mood',
    name: '컨디션',
    unit: undefined,
    scored: false,
    aggregate: 'last',
    scale: { min: 1, max: 9 },
    order: 2,
  })
}

beforeEach(resetIds)
afterEach(cleanup)

describe('오늘 화면 — 기록 지표 섹션', () => {
  it('기록 지표는 습관 목록이 아니라 기록 섹션에 나온다', async () => {
    mountToday({ definitions: [water(), caffeine()] })

    const measures = await sectionOf('기록')
    expect(within(measures).getByText('카페인')).toBeTruthy()

    const habits = await sectionOf('습관')
    expect(within(habits).getByText('물')).toBeTruthy()
    expect(within(habits).queryByText('카페인')).toBeNull()
  })

  it('기록 지표 행에는 스트릭 불꽃도 최근 7일 점도 없다', async () => {
    mountToday({
      definitions: [caffeine()],
      records: [makeRecord('caffeine', '2026-03-12T09:00:00+09:00', 60)],
    })

    const measures = await sectionOf('기록')
    expect(within(measures).queryByText(/🔥/)).toBeNull()
    expect(measures.querySelectorAll('.dots')).toHaveLength(0)
    expect(measures.querySelectorAll('.dot')).toHaveLength(0)
  })

  it('판정 지표는 습관 목록에 남고 스트릭과 최근 7일이 보인다', async () => {
    mountToday({
      definitions: [water(), caffeine()],
      records: dailyRecords('water', ['2026-03-11', '2026-03-12'], 2000),
    })

    const habits = await sectionOf('습관')
    expect(within(habits).getByText('🔥 2')).toBeTruthy()
    expect(habits.querySelectorAll('.dot')).toHaveLength(7)
  })

  it('기록 지표가 하나도 없으면 기록 섹션 자체를 그리지 않는다', async () => {
    mountToday({ definitions: [water()] })

    await screen.findByText('물')
    expect(screen.queryByRole('heading', { name: '기록' })).toBeNull()
  })
})

describe('오늘 화면 — 척도 입력', () => {
  it('척도가 있으면 숫자 입력 대신 칩이 나오고 누르면 그 값이 기록된다', async () => {
    const user = userEvent.setup()
    mountToday({ definitions: [mood()] })

    const measures = await sectionOf('기록')
    expect(within(measures).queryByLabelText('컨디션 추가할 양')).toBeNull()
    expect(within(measures).getAllByRole('button', { name: /컨디션 \d+ 기록/ })).toHaveLength(9)

    await user.click(screen.getByRole('button', { name: '컨디션 5 기록' }))

    expect(await screen.findByLabelText(/컨디션 마지막 값 5/)).toBeTruthy()
  })

  it('마지막만 세는 지표는 두 번 누르면 나중 값이 그날 값이다', async () => {
    const user = userEvent.setup()
    const clock = mutableClock(NOW)
    mountToday({ definitions: [mood()] }, clock)
    await sectionOf('기록')

    await user.click(screen.getByRole('button', { name: '컨디션 5 기록' }))
    await screen.findByLabelText(/컨디션 마지막 값 5/)

    clock.advanceHours(1)
    await user.click(screen.getByRole('button', { name: '컨디션 8 기록' }))

    await waitFor(() => expect(screen.getByLabelText(/컨디션 마지막 값 8/)).toBeTruthy())
    expect(screen.queryByLabelText(/컨디션 마지막 값 13/)).toBeNull()
  })

  it('척도 범위가 뒤집혔거나 터무니없으면 칩을 만들지 않는다', () => {
    expect(scaleValues(1, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(scaleValues(5, 4)).toEqual([])
    expect(scaleValues(Number.NaN, 9)).toEqual([])
    expect(scaleValues(1, 10_000)).toEqual([])
  })
})

describe('오늘 화면 — 기록 지표의 값과 시각', () => {
  it('합계로 세는 지표는 두 번 넣으면 합계가 보인다', async () => {
    const user = userEvent.setup()
    const clock = mutableClock(NOW)
    mountToday({ definitions: [caffeine()] }, clock)

    const measures = await sectionOf('기록')
    const add = async (value: string) => {
      await user.type(within(measures).getByLabelText('카페인 추가할 양'), value)
      await user.click(within(measures).getByRole('button', { name: '카페인 추가' }))
    }

    await add('60')
    await waitFor(() => expect(screen.getByLabelText(/카페인 합계 60 mg/)).toBeTruthy())

    clock.advanceHours(1)
    await add('90')
    await waitFor(() => expect(screen.getByLabelText(/카페인 합계 150 mg/)).toBeTruthy())
  })

  it('마지막 기록 시각이 화면에 나오고, 없으면 한국어로 알린다', async () => {
    const user = userEvent.setup()
    mountToday({ definitions: [caffeine()] })

    const measures = await sectionOf('기록')
    expect(within(measures).getByText('아직 기록 없음')).toBeTruthy()

    await user.type(within(measures).getByLabelText('카페인 추가할 양'), '60')
    await user.click(within(measures).getByRole('button', { name: '카페인 추가' }))

    expect(await within(measures).findByText('20:00')).toBeTruthy()
    expect(within(measures).queryByText('아직 기록 없음')).toBeNull()
  })

  it('되돌리기가 마지막 기록만 지운다', async () => {
    const user = userEvent.setup()
    const clock = mutableClock(NOW)
    mountToday({ definitions: [mood()] }, clock)
    await sectionOf('기록')

    const undo = () => screen.getByRole('button', { name: '컨디션 마지막 기록 취소' })
    expect(undo().hasAttribute('disabled')).toBe(true)

    await user.click(screen.getByRole('button', { name: '컨디션 5 기록' }))
    clock.advanceHours(1)
    await user.click(screen.getByRole('button', { name: '컨디션 8 기록' }))
    await waitFor(() => expect(screen.getByLabelText(/컨디션 마지막 값 8/)).toBeTruthy())

    await user.click(undo())
    await waitFor(() => expect(screen.getByLabelText(/컨디션 마지막 값 5/)).toBeTruthy())

    await user.click(undo())
    await waitFor(() => expect(undo().hasAttribute('disabled')).toBe(true))
  })

  it('칩과 값 표시에 aria-label이 붙어 문장으로 읽힌다', async () => {
    const user = userEvent.setup()
    mountToday({ definitions: [caffeine(), mood()] })
    await sectionOf('기록')

    expect(screen.getByRole('button', { name: '컨디션 1 기록' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '컨디션 9 기록' })).toBeTruthy()
    expect(screen.getByLabelText('카페인 아직 기록이 없습니다')).toBeTruthy()
    expect(screen.getByLabelText('컨디션 아직 기록이 없습니다')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '컨디션 3 기록' }))

    expect(await screen.findByLabelText('컨디션 마지막 값 3, 마지막 기록 20:00')).toBeTruthy()
  })
})

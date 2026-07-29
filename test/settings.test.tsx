// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Snapshot, Store, TableName } from '../src/data/store'
import { fixedClock } from '../src/lib/clock'
import { DEFAULT_SETTINGS, type Definition } from '../src/lib/types'
import { Settings } from '../src/screens/Settings'
import { AppProvider } from '../src/state/app'
import { resetIds } from './factories'

const NOW = '2026-03-12T20:00:00+09:00'

function emptySnapshot(): Snapshot {
  return {
    definitions: [],
    records: [],
    todos: [],
    projects: [],
    books: [],
    journal: [],
    settings: DEFAULT_SETTINGS,
  }
}

function collectingStore(written: Definition[]): Store {
  const snapshot = emptySnapshot()
  return {
    deviceId: async () => 'test-device',
    adoptDeviceId: async () => undefined,
    loadAll: async () => snapshot,
    put: async (table: TableName, rows: unknown[]) => {
      if (table === 'definitions') written.push(...(rows as Definition[]))
    },
    putSettings: async () => undefined,
    replaceAll: async () => undefined,
  }
}

function mount(written: Definition[]) {
  return render(
    createElement(AppProvider, {
      store: collectingStore(written),
      clock: fixedClock(NOW),
      children: createElement(Settings),
    }),
  )
}

async function openComposer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '+ 새 습관' }))
  await user.type(screen.getByLabelText('습관 이름'), '컨디션')
}

async function openAdvanced(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '자세히' }))
}

beforeEach(resetIds)
afterEach(cleanup)

describe('설정 — 지표 만들기', () => {
  it('아무 옵션도 건드리지 않으면 지금과 똑같은 정의가 만들어진다', async () => {
    const user = userEvent.setup()
    const written: Definition[] = []
    mount(written)

    await openComposer(user)
    await user.click(screen.getByRole('button', { name: '만들기' }))

    expect(written).toHaveLength(1)
    const def = written[0]!
    expect(def.name).toBe('컨디션')
    expect(def.kind).toBe('check')
    expect(def.scored).toBeUndefined()
    expect(def.aggregate).toBeUndefined()
    expect(def.scale).toBeUndefined()

    const stored = JSON.parse(JSON.stringify(def)) as Record<string, unknown>
    expect('scored' in stored).toBe(false)
    expect('aggregate' in stored).toBe(false)
    expect('scale' in stored).toBe(false)
  })

  it('자세히는 접힌 채로 시작한다', async () => {
    const user = userEvent.setup()
    mount([])

    await openComposer(user)

    const more = screen.getByRole('button', { name: '자세히' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByLabelText('기록만 남긴다')).toBeNull()
  })

  it('기록만 남긴다를 고르면 판정하지 않는 정의가 된다', async () => {
    const user = userEvent.setup()
    const written: Definition[] = []
    mount(written)

    await openComposer(user)
    await openAdvanced(user)
    await user.click(screen.getByLabelText('기록만 남긴다'))
    await user.click(screen.getByRole('button', { name: '만들기' }))

    expect(written[0]!.scored).toBe(false)
  })

  it('기록만 남긴다를 고르면 하루 목표 입력이 사라진다', async () => {
    const user = userEvent.setup()
    mount([])

    await openComposer(user)
    await user.click(screen.getByLabelText('수량'))
    expect(screen.getByLabelText('하루 목표')).toBeTruthy()

    await openAdvanced(user)
    await user.click(screen.getByLabelText('기록만 남긴다'))
    expect(screen.queryByLabelText('하루 목표')).toBeNull()
  })

  it('그날 마지막 값을 고르면 집계 방식이 붙는다', async () => {
    const user = userEvent.setup()
    const written: Definition[] = []
    mount(written)

    await openComposer(user)
    await user.click(screen.getByLabelText('수량'))
    await openAdvanced(user)
    await user.click(screen.getByLabelText('그날 마지막 값'))
    await user.click(screen.getByRole('button', { name: '만들기' }))

    expect(written[0]!.aggregate).toBe('last')
  })

  it('척도를 켜면 최소와 최대가 정의에 붙는다', async () => {
    const user = userEvent.setup()
    const written: Definition[] = []
    mount(written)

    await openComposer(user)
    await user.click(screen.getByLabelText('수량'))
    await openAdvanced(user)
    await user.click(screen.getByLabelText('척도로 입력'))
    await user.clear(screen.getByLabelText('척도 최소'))
    await user.type(screen.getByLabelText('척도 최소'), '1')
    await user.clear(screen.getByLabelText('척도 최대'))
    await user.type(screen.getByLabelText('척도 최대'), '9')
    await user.click(screen.getByRole('button', { name: '만들기' }))

    expect(written[0]!.scale).toEqual({ min: 1, max: 9 })
  })

  it('척도는 0부터 시작할 수 없다', async () => {
    const user = userEvent.setup()
    mount([])

    await openComposer(user)
    await user.click(screen.getByLabelText('수량'))
    await openAdvanced(user)
    await user.click(screen.getByLabelText('척도로 입력'))
    await user.clear(screen.getByLabelText('척도 최소'))
    await user.type(screen.getByLabelText('척도 최소'), '0')

    expect(screen.getByRole('button', { name: '만들기' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/1 이상/)).toBeTruthy()
  })

  it('척도 최대가 최소보다 작으면 만들 수 없다', async () => {
    const user = userEvent.setup()
    mount([])

    await openComposer(user)
    await user.click(screen.getByLabelText('수량'))
    await openAdvanced(user)
    await user.click(screen.getByLabelText('척도로 입력'))
    await user.clear(screen.getByLabelText('척도 최대'))
    await user.type(screen.getByLabelText('척도 최대'), '1')

    expect(screen.getByRole('button', { name: '만들기' }).hasAttribute('disabled')).toBe(true)
  })

  it('체크형에는 집계 방식과 척도가 뜨지 않는다', async () => {
    const user = userEvent.setup()
    mount([])

    await openComposer(user)
    await openAdvanced(user)

    expect(screen.getByLabelText('기록만 남긴다')).toBeTruthy()
    expect(screen.queryByLabelText('그날 마지막 값')).toBeNull()
    expect(screen.queryByLabelText('척도로 입력')).toBeNull()
  })

  it('기록 지표에는 목표를 보여주지도 바꾸지도 않는다', async () => {
    const user = userEvent.setup()
    mount([])

    await user.click(await screen.findByRole('button', { name: '카페인 추가' }))

    const row = (await screen.findByText('카페인')).closest('.def')!
    expect(within(row as HTMLElement).getByText('기록만')).toBeTruthy()
    expect(within(row as HTMLElement).queryByText(/목표/)).toBeNull()
    expect(within(row as HTMLElement).queryByRole('button', { name: '목표 변경' })).toBeNull()
  })

  it('판정 지표는 그대로 목표를 보여준다', async () => {
    const user = userEvent.setup()
    mount([])

    await user.click(await screen.findByRole('button', { name: '물 추가' }))

    const row = (await screen.findByText('물')).closest('.def')!
    expect(within(row as HTMLElement).getByText(/목표 2000/)).toBeTruthy()
    expect(within(row as HTMLElement).getByRole('button', { name: '목표 변경' })).toBeTruthy()
    expect(within(row as HTMLElement).queryByText('기록만')).toBeNull()
  })

  it('컨디션 프리셋이 목록에 있다', async () => {
    const user = userEvent.setup()
    const written: Definition[] = []
    mount(written)

    await user.click(await screen.findByRole('button', { name: '컨디션 추가' }))

    expect(written[0]!.name).toBe('컨디션')
    expect(written[0]!.scored).toBe(false)
    expect(written[0]!.aggregate).toBe('last')
    expect(written[0]!.scale).toEqual({ min: 1, max: 9 })
  })
})

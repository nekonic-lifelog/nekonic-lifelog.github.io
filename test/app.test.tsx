// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../src/App'
import { IdbStore } from '../src/data/idb'
import { fixedClock, mutableClock, type Clock } from '../src/lib/clock'
import { AppProvider } from '../src/state/app'

const NOW = '2026-03-12T20:00:00+09:00'

const live: IdbStore[] = []

function closeAll() {
  for (const store of live) store.close()
  live.length = 0
}

beforeEach(async () => {
  window.location.hash = '#/today'
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    })
  }
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

function mount(clock: Clock = fixedClock(NOW)) {
  const store = new IdbStore()
  live.push(store)
  const result = render(
    <AppProvider store={store} clock={clock}>
      <App />
    </AppProvider>,
  )
  return { store, ...result }
}

async function ready() {
  await waitFor(() => expect(screen.queryByText('불러오는 중…')).not.toBeTruthy())
}

describe('앱 배선', () => {
  it('네 탭이 전부 서 있다', async () => {
    mount()
    await ready()
    for (const label of ['오늘', '할 일', '기록', '통계']) {
      expect(screen.getAllByRole('button', { name: label }).length).toBeGreaterThan(0)
    }
  })

  it('빈 상태에서 오늘 화면이 뜬다', async () => {
    mount()
    await ready()
    expect(screen.getByText(/아직 습관이 없습니다/)).toBeTruthy()
  })

  it('기록·통계 탭은 비어 있어도 열린다', async () => {
    const user = userEvent.setup()
    mount()
    await ready()

    await user.click(screen.getByRole('button', { name: '기록' }))
    expect(await screen.findByText(/일기 · 회의록/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '통계' }))
    expect(await screen.findByText(/달성률/)).toBeTruthy()
  })
})

describe('습관 — 만들고 체크하기', () => {
  async function createHabit(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(screen.getAllByRole('button', { name: '설정' })[0]!)
    await user.click(await screen.findByRole('button', { name: '+ 새 습관' }))
    await user.type(screen.getByLabelText('습관 이름'), name)
    await user.click(screen.getByRole('button', { name: '만들기' }))
    await waitFor(() => expect(screen.queryByLabelText('습관 이름')).not.toBeTruthy())
  }

  it('설정에서 만든 습관이 오늘 화면에 나타나고 체크하면 스트릭이 선다', async () => {
    const user = userEvent.setup()
    mount()
    await ready()

    await createHabit(user, '아침 약')

    await user.click(screen.getAllByRole('button', { name: '오늘' })[0]!)
    expect(await screen.findByText('아침 약')).toBeTruthy()

    const check = screen.getByRole('button', { name: '아침 약 체크' })
    expect(check.getAttribute('aria-pressed')).toBe('false')

    await user.click(check)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '아침 약 체크' }).getAttribute('aria-pressed'),
      ).toBe('true'),
    )
    expect(await screen.findByText('🔥 1')).toBeTruthy()
  })

  it('체크한 것이 새로 연 앱에도 남아 있다 — IndexedDB에 실제로 쓴다', async () => {
    const user = userEvent.setup()
    const first = mount()
    await ready()
    await createHabit(user, '물 마시기')
    await user.click(screen.getAllByRole('button', { name: '오늘' })[0]!)
    await user.click(await screen.findByRole('button', { name: '물 마시기 체크' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '물 마시기 체크' }).getAttribute('aria-pressed'),
      ).toBe('true'),
    )

    first.unmount()
    first.store.close()

    mount()
    await ready()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '물 마시기 체크' }).getAttribute('aria-pressed'),
      ).toBe('true'),
    )
  })

  it('다시 누르면 체크가 풀린다 (tombstone)', async () => {
    const user = userEvent.setup()
    mount()
    await ready()
    await createHabit(user, '운동')
    await user.click(screen.getAllByRole('button', { name: '오늘' })[0]!)

    const check = () => screen.getByRole('button', { name: '운동 체크' })
    await user.click(await screen.findByRole('button', { name: '운동 체크' }))
    await waitFor(() => expect(check().getAttribute('aria-pressed')).toBe('true'))

    await user.click(check())
    await waitFor(() => expect(check().getAttribute('aria-pressed')).toBe('false'))
  })
})

describe('수량 습관 — 되돌리기', () => {
  async function createWater(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getAllByRole('button', { name: '설정' })[0]!)
    await user.click(await screen.findByRole('button', { name: '+ 새 습관' }))
    await user.type(screen.getByLabelText('습관 이름'), '물')
    await user.click(screen.getByLabelText('수량'))
    await user.type(screen.getByLabelText('단위'), 'ml')
    await user.type(screen.getByLabelText('하루 목표'), '2000')
    await user.click(screen.getByRole('button', { name: '만들기' }))
    await waitFor(() => expect(screen.queryByLabelText('습관 이름')).not.toBeTruthy())
    await user.click(screen.getAllByRole('button', { name: '오늘' })[0]!)
    await screen.findByLabelText('물 추가할 양')
  }

  const add = async (user: ReturnType<typeof userEvent.setup>, value: string) => {
    await user.type(screen.getByLabelText('물 추가할 양'), value)
    await user.click(screen.getByRole('button', { name: '추가' }))
  }

  const amount = () => screen.getByText(/\/ 2000/).textContent?.replace(/\s+/g, ' ').trim()

  it('컨트롤은 추가와 되돌리기 둘뿐이다', async () => {
    const user = userEvent.setup()
    mount()
    await ready()
    await createWater(user)

    const row = screen.getByLabelText('물 추가할 양').closest('.qty')!
    expect(within(row as HTMLElement).getAllByRole('button')).toHaveLength(2)
  })

  it('되돌리기 버튼은 기록이 없어도 자리를 지킨다', async () => {
    const user = userEvent.setup()
    mount()
    await ready()
    await createWater(user)

    const undo = () => screen.getByRole('button', { name: '마지막 입력 취소' })
    expect(undo().hasAttribute('disabled')).toBe(true)

    await add(user, '700')
    await waitFor(() => expect(undo().hasAttribute('disabled')).toBe(false))
  })

  it('되돌리기는 마지막 한 건만 지운다', async () => {
    const user = userEvent.setup()
    const clock = mutableClock(NOW)
    mount(clock)
    await ready()
    await createWater(user)

    await add(user, '700')
    await waitFor(() => expect(amount()).toBe('700 / 2000 ml'))

    clock.advanceHours(1)
    await add(user, '3')
    await waitFor(() => expect(amount()).toBe('703 / 2000 ml'))

    await user.click(screen.getByRole('button', { name: '마지막 입력 취소' }))
    await waitFor(() => expect(amount()).toBe('700 / 2000 ml'))

    await user.click(screen.getByRole('button', { name: '마지막 입력 취소' }))
    await waitFor(() => expect(amount()).toBe('0 / 2000 ml'))
  })

  it('되돌리기를 반복하면 그날이 비고, 거기서 멈춘다', async () => {
    const user = userEvent.setup()
    const clock = mutableClock(NOW)
    mount(clock)
    await ready()
    await createWater(user)

    await add(user, '400')
    clock.advanceHours(1)
    await add(user, '300')
    await waitFor(() => expect(amount()).toBe('700 / 2000 ml'))

    const undo = () => screen.getByRole('button', { name: '마지막 입력 취소' })
    await user.click(undo())
    await waitFor(() => expect(amount()).toBe('400 / 2000 ml'))
    await user.click(undo())
    await waitFor(() => expect(amount()).toBe('0 / 2000 ml'))

    await waitFor(() => expect(undo().hasAttribute('disabled')).toBe(true))
  })
})

describe('하루 경계 설정', () => {
  const field = () => screen.getByLabelText('하루 경계 시각') as HTMLInputElement

  async function openSettings(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getAllByRole('button', { name: '설정' })[0]!)
    await screen.findByLabelText('하루 경계 시각')
  }

  it('고쳐 쓰려고 비워도 자정으로 넘어가지 않는다', async () => {
    const user = userEvent.setup()
    const { store } = mount()
    await ready()
    await openSettings(user)
    expect(field().value).toBe('4')

    await user.clear(field())
    expect((await store.loadAll()).settings.dayBoundaryHour).toBe(4)

    await user.type(field(), '5')
    await waitFor(async () =>
      expect((await store.loadAll()).settings.dayBoundaryHour).toBe(5),
    )
  })

  it('비운 채로 떠나면 저장된 값으로 되돌아온다', async () => {
    const user = userEvent.setup()
    mount()
    await ready()
    await openSettings(user)

    await user.clear(field())
    expect(field().value).toBe('')
    await user.tab()
    await waitFor(() => expect(field().value).toBe('4'))
  })

  it('범위를 벗어난 값은 저장하지 않고, 떠나면 되돌린다', async () => {
    const user = userEvent.setup()
    const { store } = mount()
    await ready()
    await openSettings(user)

    fireEvent.change(field(), { target: { value: '23' } })
    expect((await store.loadAll()).settings.dayBoundaryHour).toBe(4)

    fireEvent.blur(field())
    await waitFor(() => expect(field().value).toBe('4'))
  })
})

describe('할 일과 D-day', () => {
  it('기한과 고정을 준 할 일이 D-day 화면에 올라간다', async () => {
    const user = userEvent.setup()
    mount()
    await ready()

    await user.click(screen.getAllByRole('button', { name: '할 일' })[0]!)
    await user.type(await screen.findByLabelText('할 일 제목'), '병원 예약')
    await user.type(screen.getByLabelText('기한'), '2026-03-15')
    await user.click(screen.getByLabelText(/D-day로 고정/))
    await user.click(screen.getByRole('button', { name: '추가' }))

    expect(await screen.findByText('병원 예약')).toBeTruthy()

    await user.click(screen.getAllByRole('button', { name: 'D-day' })[0]!)
    const list = await screen.findByRole('list')
    expect(within(list).getByText('병원 예약')).toBeTruthy()
    expect(within(list).getByText('D-3')).toBeTruthy()
  })

  it('기한이 지난 할 일은 경과일로 뒤집어 보여준다', async () => {
    const user = userEvent.setup()
    mount()
    await ready()

    await user.click(screen.getAllByRole('button', { name: '할 일' })[0]!)
    await user.type(await screen.findByLabelText('할 일 제목'), '밀린 일')
    await user.type(screen.getByLabelText('기한'), '2026-03-09')
    await user.click(screen.getByRole('button', { name: '추가' }))

    expect(await screen.findByText('D+3')).toBeTruthy()
  })

  it('완료하면 목록에서 내려간다', async () => {
    const user = userEvent.setup()
    mount()
    await ready()

    await user.click(screen.getAllByRole('button', { name: '할 일' })[0]!)
    await user.type(await screen.findByLabelText('할 일 제목'), '쓰레기 버리기')
    await user.click(screen.getByRole('button', { name: '추가' }))

    await user.click(await screen.findByRole('button', { name: '쓰레기 버리기 완료 토글' }))
    await waitFor(() => expect(screen.getByText(/완료 1건/)).toBeTruthy())
  })
})

// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../src/App'
import { IdbStore } from '../src/data/idb'
import { fixedClock, mutableClock, type Clock } from '../src/lib/clock'
import { SCHEMA_VERSION } from '../src/lib/types'
import { AppProvider, useApp, type AppApi } from '../src/state/app'
import { onDirty } from '../src/state/dirty'
import { makeDef } from './factories'

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
  vi.restoreAllMocks()
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

describe('변경 신호 — 설정과 전체 교체', () => {
  function mountApi() {
    const store = new IdbStore()
    live.push(store)
    let api: AppApi | null = null
    function Probe() {
      api = useApp()
      return null
    }
    render(
      <AppProvider store={store} clock={fixedClock(NOW)}>
        <Probe />
      </AppProvider>,
    )
    return {
      store,
      get api() {
        return api
      },
    }
  }

  async function readyApi(mounted: ReturnType<typeof mountApi>) {
    await waitFor(() => expect(mounted.api?.ready).toBe(true))
    return mounted.api!
  }

  it('설정을 저장하면 동기화에 알린다', async () => {
    let fired = 0
    const off = onDirty(() => {
      fired += 1
    })
    const mounted = mountApi()
    const api = await readyApi(mounted)

    await act(async () => {
      await api.saveSettings({ dayBoundaryHour: 6 })
    })

    expect(fired).toBe(1)
    expect((await mounted.store.loadAll()).settings.dayBoundaryHour).toBe(6)
    off()
  })

  it('전체 교체도 동기화에 알린다', async () => {
    let fired = 0
    const off = onDirty(() => {
      fired += 1
    })
    const mounted = mountApi()
    const api = await readyApi(mounted)
    const next = { ...api.snapshot, definitions: [makeDef({ name: '되살린 습관' })] }

    await act(async () => {
      await api.replaceAll(next)
    })

    expect(fired).toBe(1)
    expect((await mounted.store.loadAll()).definitions).toHaveLength(1)
    off()
  })
})

describe('백업 불러오기 — 되돌릴 수 없는 교체', () => {
  const IMPORTED = JSON.stringify({
    v: SCHEMA_VERSION,
    exportedAt: '2026-03-01T00:00:00.000Z',
    data: {
      definitions: [makeDef({ id: 'imported-def', name: '불러온 습관' })],
      records: [],
      todos: [],
      settings: {},
    },
  })

  function seededStore() {
    const store = new IdbStore()
    live.push(store)
    return store
  }

  async function mountSettings(store: IdbStore) {
    render(
      <AppProvider store={store} clock={fixedClock(NOW)}>
        <App />
      </AppProvider>,
    )
    await ready()
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: '설정' })[0]!)
    await screen.findByRole('heading', { name: '백업' })
  }

  function fileInput(): HTMLInputElement {
    const input = document.querySelector('input[type="file"]')
    if (!input) throw new Error('파일 입력이 없습니다')
    return input as HTMLInputElement
  }

  function drop(json: string) {
    fireEvent.change(fileInput(), {
      target: { files: [new File([json], 'backup.json', { type: 'application/json' })] },
    })
  }

  it('불러오기 전에 현재 데이터를 파일로 자동 저장한다', async () => {
    const saved: Blob[] = []
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        saved.push(blob)
        return 'blob:auto-backup'
      },
      revokeObjectURL: () => undefined,
    })

    const store = seededStore()
    await store.put('definitions', [makeDef({ id: 'before-def', name: '바꾸기 전 습관' })])
    await mountSettings(store)

    drop(IMPORTED)

    await waitFor(async () =>
      expect((await store.loadAll()).definitions.map((d) => d.id)).toEqual(['imported-def']),
    )

    expect(saved).toHaveLength(1)
    const dumped = await saved[0]!.text()
    expect(dumped).toContain('바꾸기 전 습관')
    expect(dumped).not.toContain('불러온 습관')

    vi.unstubAllGlobals()
  })

  it('자동 내보내기가 실패하면 데이터를 바꾸지 않는다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => {
        throw new Error('내려받기를 막았습니다')
      },
      revokeObjectURL: () => undefined,
    })

    const store = seededStore()
    await store.put('definitions', [makeDef({ id: 'before-def', name: '바꾸기 전 습관' })])
    await mountSettings(store)

    drop(IMPORTED)

    expect(await screen.findByText(/자동 저장하지 못해/)).toBeTruthy()
    expect((await store.loadAll()).definitions.map((d) => d.id)).toEqual(['before-def'])

    vi.unstubAllGlobals()
  })

  it('확인 문구가 원격과 다른 기기까지 바뀐다고 알린다', async () => {
    const asked: string[] = []
    vi.spyOn(window, 'confirm').mockImplementation((msg?: string) => {
      asked.push(String(msg))
      return false
    })

    const store = seededStore()
    await store.put('definitions', [makeDef({ id: 'before-def', name: '바꾸기 전 습관' })])
    await mountSettings(store)

    drop(IMPORTED)

    await waitFor(() => expect(asked).toHaveLength(1))
    expect(asked[0]).toContain('원격')
    expect(asked[0]).toContain('다른 기기')
    expect((await store.loadAll()).definitions.map((d) => d.id)).toEqual(['before-def'])
  })
})

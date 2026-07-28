// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '../src/App'
import { IdbStore } from '../src/data/idb'
import { fixedClock } from '../src/lib/clock'
import { AppProvider } from '../src/state/app'
import { notifyDirty, onDirty } from '../src/state/dirty'
import { SyncProvider } from '../src/state/sync'
import { memoryCredentials } from '../src/sync/credentials'

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

function mount() {
  const store = new IdbStore()
  live.push(store)
  const clock = fixedClock(NOW)
  return render(
    <AppProvider store={store} clock={clock}>
      <SyncProvider
        store={store}
        clock={clock}
        credentials={memoryCredentials()}
        autoConnect={false}
      >
        <App />
      </SyncProvider>
    </AppProvider>,
  )
}

async function ready() {
  await waitFor(() => expect(screen.queryByText('불러오는 중…')).not.toBeTruthy())
}

async function open(name: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name }))
}

describe('탭 배선', () => {
  it('네 탭이 전부 있다', async () => {
    mount()
    await ready()
    for (const label of ['오늘', '할 일', '기록', '통계']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('기록 탭이 자리표시가 아니라 실제 화면이다', async () => {
    mount()
    await ready()
    await open('기록')
    await screen.findByRole('button', { name: '일기 쓰기' })
    expect(screen.queryByText('준비 중')).toBeNull()
    expect(screen.getByRole('button', { name: '회의록 쓰기' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '메모 쓰기' })).toBeTruthy()
  })

  it('통계 탭이 자리표시가 아니라 실제 화면이다', async () => {
    mount()
    await ready()
    await open('통계')
    await screen.findByText(/달성률/)
    expect(screen.queryByText('준비 중')).toBeNull()
  })

  it('할 일 탭에 개인 할 일이 그대로 있다', async () => {
    mount()
    await ready()
    await open('할 일')
    await screen.findByRole('button', { name: '추가' })
  })
})

describe('헤더와 곁가지 화면', () => {
  it('기록에서 독서로 갈 수 있다', async () => {
    mount()
    await ready()
    await open('기록')
    await open('독서')
    await screen.findByRole('heading', { name: '독서' })
  })

  it('헤더에서 타이머를 연다', async () => {
    mount()
    await ready()
    await open('타이머')
    await screen.findByRole('heading', { name: '타이머' })
  })

  it('헤더에서 D-day를 연다', async () => {
    mount()
    await ready()
    await open('D-day')
    await screen.findByRole('heading', { name: 'D-day' })
  })

  it('설정에서 기기 연결 화면으로 갈 수 있다', async () => {
    mount()
    await ready()
    await open('설정')
    await open('저장소에 잇기')
    await open('기기 연결 (QR · 수동 입력)')
    await screen.findByRole('heading', { name: '기기 연결' })
  })
})

describe('동기화 배선', () => {
  it('미연결이어도 잠금 없이 바로 열린다', async () => {
    mount()
    await ready()
    expect(screen.queryByLabelText('암호구절')).toBeNull()
    expect(screen.queryByLabelText('토큰')).toBeNull()
  })

  it('설정에 동기화 상태가 보인다', async () => {
    mount()
    await ready()
    await open('설정')
    await screen.findByRole('heading', { name: '동기화' })
    expect(screen.getByText('미연결')).toBeTruthy()
  })

  it('연결 폼이 복구 불가를 고지하고 확인을 받는다', async () => {
    mount()
    await ready()
    await open('설정')
    await open('저장소에 잇기')
    expect(await screen.findByLabelText('암호구절')).toBeTruthy()
    expect(screen.getByText(/찾기 기능은 없습니다/)).toBeTruthy()
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
  })

  it('토큰 입력이 화면에 드러나지 않는다', async () => {
    mount()
    await ready()
    await open('설정')
    await open('저장소에 잇기')
    const token = await screen.findByLabelText('토큰')
    expect(token.getAttribute('type')).toBe('password')
  })
})

describe('정의 프리셋', () => {
  it('설정에 프리셋이 있다', async () => {
    mount()
    await ready()
    await open('설정')
    await screen.findByRole('heading', { name: '습관 정의' })
    expect(screen.getByRole('button', { name: '아침 약 추가' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '물 추가' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '카페인 추가' })).toBeTruthy()
  })

  it('프리셋을 누르면 정의가 생기고 오늘 화면에 나온다', async () => {
    mount()
    await ready()
    await open('설정')
    await screen.findByRole('heading', { name: '습관 정의' })
    await open('아침 약 추가')

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '아침 약 추가' })).toHaveProperty(
        'disabled',
        true,
      ),
    )

    await open('오늘')
    await waitFor(() => expect(screen.getAllByText('아침 약').length).toBeGreaterThan(0))
  })
})

describe('변경 신호', () => {
  it('프리셋으로 정의를 만들면 동기화에 알린다', async () => {
    let fired = 0
    const off = onDirty(() => {
      fired += 1
    })

    mount()
    await ready()
    await open('설정')
    await screen.findByRole('heading', { name: '습관 정의' })
    await open('아침 약 추가')
    await waitFor(() => expect(fired).toBeGreaterThan(0))

    off()
  })

  it('구독을 끊으면 더 이상 신호를 받지 않는다', () => {
    let fired = 0
    const off = onDirty(() => {
      fired += 1
    })
    notifyDirty()
    expect(fired).toBe(1)
    off()
    notifyDirty()
    expect(fired).toBe(1)
  })
})

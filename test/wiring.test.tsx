// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

describe('알림 설정', () => {
  it('설정에 알림 구역이 있고 평문으로 나간다고 알린다', async () => {
    mount()
    await ready()
    await open('설정')
    await screen.findByRole('heading', { name: '알림' })
    expect(screen.getByText(/평문으로/)).toBeTruthy()
    expect(screen.getByText('Asia/Seoul')).toBeTruthy()
    expect(screen.getByText('반복 알림이 없습니다.')).toBeTruthy()
  })

  it('반복 알림을 더하면 목록에 남는다', async () => {
    mount()
    await ready()
    await open('설정')
    await screen.findByRole('heading', { name: '알림' })
    await open('+ 반복 알림')

    fireEvent.change(await screen.findByLabelText('반복 알림 시각'), {
      target: { value: '18:00' },
    })
    fireEvent.change(screen.getByLabelText('반복 알림 라벨'), {
      target: { value: '저녁 약' },
    })
    await open('반복 알림 추가')

    await screen.findByText('저녁 약')
    expect(screen.getByText('18:00')).toBeTruthy()
    expect(screen.queryByText('반복 알림이 없습니다.')).toBeNull()
  })

  it('사전 알림 오프셋과 제목 가리기를 켜고 끌 수 있다', async () => {
    mount()
    await ready()
    await open('설정')
    await screen.findByRole('heading', { name: '알림' })

    const twoHours = screen.getByRole('button', { name: '2시간 전' })
    expect(twoHours.getAttribute('aria-pressed')).toBe('true')
    await open('2시간 전')
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '2시간 전' }).getAttribute('aria-pressed'),
      ).toBe('false'),
    )

    await open('프로젝트 작업 제목 가림')
    await screen.findByRole('button', { name: '프로젝트 작업 제목 그대로' })
  })
})

describe('오늘에서 내린 습관', () => {
  async function addPresetThenArchive() {
    mount()
    await ready()
    await open('설정')
    await screen.findByRole('heading', { name: '습관 정의' })
    await open('물 추가')
    await screen.findByText('오늘에서 내리기')
    await open('오늘에서 내리기')
    await screen.findByText('오늘에 다시 띄우기')
  }

  it('내린 습관은 오늘 화면에 뜨지 않는다', async () => {
    await addPresetThenArchive()
    await open('오늘')
    await waitFor(() => expect(screen.queryByText('물')).toBeNull())
  })

  it('없다고 하지 않고 내려둔 것이 있다고 알린다', async () => {
    await addPresetThenArchive()
    await open('오늘')
    const msg = await screen.findByText(/내려둔 습관/)
    expect(msg.textContent).toContain('물')
    expect(screen.queryByText(/아직 습관이 없습니다/)).toBeNull()
  })

  it('습관이 정말 하나도 없으면 없다고 한다', async () => {
    mount()
    await ready()
    await screen.findByText(/아직 습관이 없습니다/)
    expect(screen.queryByText(/내려둔 습관/)).toBeNull()
  })

  it('다시 띄우면 오늘 화면으로 돌아온다', async () => {
    await addPresetThenArchive()
    await open('오늘에 다시 띄우기')
    await open('오늘')
    await waitFor(() => expect(screen.getAllByText('물').length).toBeGreaterThan(0))
    expect(screen.queryByText(/내려둔 습관/)).toBeNull()
  })

  it('설정 목록에는 내린 뒤에도 남는다', async () => {
    await addPresetThenArchive()
    expect(screen.getByText('오늘에서 내림')).toBeTruthy()
  })
})

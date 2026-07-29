// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SyncStatus } from '../src/ui/SyncStatus'
import { initialSyncState, type SyncEvent, type SyncState } from '../src/sync/engine'
import type { Clash } from '../src/sync/merge'

const NOW = Date.parse('2026-03-12T22:00:00+09:00')

function view(partial: Partial<SyncState> = {}, connected = true): ReactNode {
  return createElement(SyncStatus, {
    state: { ...initialSyncState(), ...partial },
    connected,
    now: NOW,
  })
}

function event(over: Partial<SyncEvent> = {}): SyncEvent {
  return {
    at: '2026-03-12T21:30:00+09:00',
    direction: 'pull',
    outcome: 'ok',
    read: 2,
    wrote: 0,
    skipped: 0,
    error: null,
    ...over,
  }
}

afterEach(cleanup)

describe('동기화 화면 — 이력', () => {
  it('이력이 없으면 접는 줄도 없다', () => {
    render(view())

    expect(screen.queryByText(/동기화 이력/)).toBeNull()
  })

  it('이력은 접힌 채로 건수를 알린다', () => {
    render(view({ history: [event(), event({ direction: 'push' })] }))

    const fold = screen.getByText('동기화 이력 2건')
    expect(fold.tagName).toBe('SUMMARY')
    expect(fold.closest('details')?.hasAttribute('open')).toBe(false)
  })

  it('각 줄이 시각·방향·읽고 올린 파일 수를 문장으로 갖는다', () => {
    render(view({ history: [event({ direction: 'push', read: 0, wrote: 3 })] }))

    const label = screen.getByRole('listitem').getAttribute('aria-label') ?? ''
    expect(label).toContain('03/12 21:30')
    expect(label).toContain('올리기')
    expect(label).toContain('성공')
    expect(label).toContain('읽은 파일 0개')
    expect(label).toContain('올린 파일 3개')
  })

  it('성공·부분 실패·실패가 글자로 갈린다', () => {
    render(
      view({
        history: [
          event({ outcome: 'ok' }),
          event({ outcome: 'partial', skipped: 2, error: '파일 2개를 열지 못했습니다' }),
          event({ outcome: 'failed', error: '망이 끊겼습니다' }),
        ],
      }),
    )

    const labels = screen.getAllByRole('listitem').map((el) => el.getAttribute('aria-label') ?? '')
    expect(labels[0]).toContain('성공')
    expect(labels[0]).not.toContain('일부 실패')
    expect(labels[1]).toContain('일부 실패')
    expect(labels[1]).toContain('건너뛴 파일 2개')
    expect(labels[2]).toContain('실패')
    expect(labels[2]).toContain('망이 끊겼습니다')
  })

  it('색만으로 성공과 실패를 가르지 않는다', () => {
    render(view({ history: [event({ outcome: 'failed', error: '무너짐' })] }))

    expect(screen.getByText(/받기 · 실패/)).toBeTruthy()
  })
})

describe('동기화 화면 — 부분 실패', () => {
  it('건너뛴 파일 수를 따로 세어 보여준다', () => {
    render(view({ skipped: ['/books/a.enc', '/books/b.enc'], lastError: '두 개를 못 열었습니다' }))

    expect(screen.getByText('건너뛴 파일')).toBeTruthy()
    expect(screen.getByText('2개')).toBeTruthy()
    expect(screen.getByText('두 개를 못 열었습니다')).toBeTruthy()
  })

  it('건너뛴 것이 없으면 없음이라고 한다', () => {
    render(view({ lastSuccessAt: '2026-03-12T21:59:30+09:00' }))

    expect(screen.getByText('건너뛴 파일').nextElementSibling?.textContent).toBe('없음')
    expect(screen.getByText('마지막 성공').nextElementSibling?.textContent).toBe('방금')
  })
})

describe('동기화 화면 — 백필 진행도', () => {
  it('받은 개수와 총 개수를 함께 알린다', () => {
    render(view({ backfilling: { done: 7, total: 24 } }))

    expect(screen.getByRole('status').textContent).toBe('지난 기록 24개 가운데 7개를 받았습니다.')
  })

  it('총 개수를 아직 모를 때도 무엇을 하는지 말한다', () => {
    render(view({ backfilling: { done: 0, total: 0 } }))

    expect(screen.getByRole('status').textContent).toContain('지난 기록')
  })

  it('백필이 아니면 진행도 줄이 없다', () => {
    render(view())

    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('동기화 화면 — 겹친 편집', () => {
  const clash: Clash = {
    table: 'books',
    id: 'bk-1',
    winnerDeviceId: 'pc',
    loserDeviceId: 'phone',
    loserUpdatedAt: '2026-03-12T21:00:00+09:00',
  }

  it('겹친 것이 없으면 접는 줄도 없다', () => {
    render(view())

    expect(screen.queryByText(/겹친 편집/)).toBeNull()
  })

  it('어느 기기가 남고 어느 쪽이 밀렸는지 문장으로 말한다', () => {
    render(view({ clashes: [clash] }))

    expect(screen.getByText('최근 겹친 편집 1건')).toBeTruthy()
    const label = screen.getByRole('listitem').getAttribute('aria-label') ?? ''
    expect(label).toContain('books')
    expect(label).toContain('bk-1')
    expect(label).toContain('pc')
    expect(label).toContain('phone')
    expect(label).toContain('03/12 21:00')
  })
})

describe('동기화 화면 — 미연결', () => {
  it('미연결이면 이력도 겹친 편집도 그리지 않는다', () => {
    render(view({ history: [event()], clashes: [] }, false))

    expect(screen.getByText('미연결')).toBeTruthy()
    expect(screen.queryByText(/동기화 이력/)).toBeNull()
  })
})

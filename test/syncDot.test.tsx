// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SyncDot } from '../src/ui/Shell'
import { initialSyncState, type SyncState } from '../src/sync/engine'

function dot(partial: Partial<SyncState> = {}, connected = true): ReactNode {
  return createElement(SyncDot, { state: { ...initialSyncState(), ...partial }, connected })
}

afterEach(cleanup)

describe('앱바 동기화 표시', () => {
  it('저장소에 잇지 않았으면 아무것도 그리지 않는다', () => {
    render(dot({}, false))

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('올릴 것이 없고 오류도 없으면 조용히 정상이라고만 말한다', () => {
    render(dot({ lastSuccessAt: '2026-07-29T10:00:00+09:00' }))

    const el = screen.getByRole('status')
    expect(el.getAttribute('aria-label')).toBe('동기화 정상')
    expect(el.className).not.toContain('sync-dot--warn')
    expect(el.className).not.toContain('sync-dot--bad')
  })

  it('못 올린 변경이 있으면 개수를 문장으로 알린다', () => {
    render(dot({ pendingCount: 3 }))

    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('못 올린 변경 3건')
  })

  it('토큰이 막히면 경고로 바뀐다', () => {
    render(dot({ authFailed: true, pendingCount: 2 }))

    const el = screen.getByRole('status')
    expect(el.getAttribute('aria-label')).toBe('동기화 막힘 · 토큰을 다시 넣어야 합니다')
    expect(el.className).toContain('sync-dot--bad')
  })

  it('인증 실패가 못 올린 변경보다 먼저다', () => {
    render(dot({ authFailed: true, pendingCount: 9, backfilling: { done: 2, total: 7 } }))

    expect(screen.getByRole('status').getAttribute('aria-label')).toContain('막힘')
  })

  it('지난 기록을 받는 중이면 어디까지 왔는지 알린다', () => {
    render(dot({ backfilling: { done: 2, total: 7 } }))

    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('지난 기록 받는 중 7개 중 2개')
  })

  it('받을 것이 몇 개인지 모르면 개수 없이 알린다', () => {
    render(dot({ backfilling: { done: 0, total: 0 } }))

    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('지난 기록을 받는 중')
  })

  it('오류가 남아 있으면 경고로 보여준다', () => {
    render(dot({ lastError: '열지 못한 파일이 있습니다' }))

    const el = screen.getByRole('status')
    expect(el.getAttribute('aria-label')).toContain('열지 못한 파일이 있습니다')
    expect(el.className).toContain('sync-dot--warn')
  })

  it('색만으로 구분하지 않는다 — 모든 상태가 문장을 가진다', () => {
    const states: Partial<SyncState>[] = [
      {},
      { pendingCount: 1 },
      { authFailed: true },
      { backfilling: { done: 2, total: 7 } },
      { lastError: '무언가' },
    ]

    for (const partial of states) {
      const view = render(dot(partial))
      const label = screen.getByRole('status').getAttribute('aria-label')
      expect(label).toBeTruthy()
      expect((label ?? '').length).toBeGreaterThan(3)
      view.unmount()
    }
  })
})

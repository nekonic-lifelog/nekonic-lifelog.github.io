import { useState } from 'react'
import { navigate, type Route } from '../lib/router'
import { isIOS, useStandalone } from '../lib/platform'
import { useSyncOptional } from '../state/sync'
import type { SwUpdate } from '../lib/sw'
import type { SyncState } from '../sync/engine'

const TABS: { route: Route; label: string }[] = [
  { route: '/today', label: '오늘' },
  { route: '/todos', label: '할 일' },
  { route: '/records', label: '기록' },
  { route: '/stats', label: '통계' },
]

interface DotView {
  label: string
  tone: 'ok' | 'warn' | 'bad'
}

function dotView(state: SyncState): DotView {
  if (state.authFailed) {
    return { label: '동기화 막힘 · 토큰을 다시 넣어야 합니다', tone: 'bad' }
  }
  if (state.lastError !== null) {
    return { label: `동기화 문제 · ${state.lastError}`, tone: 'warn' }
  }
  if (state.backfilling) return { label: '지난 기록을 받는 중', tone: 'warn' }
  if (state.pendingCount > 0) {
    return { label: `못 올린 변경 ${state.pendingCount}건`, tone: 'warn' }
  }
  return { label: '동기화 정상', tone: 'ok' }
}

export function SyncDot({ state, connected }: { state: SyncState; connected: boolean }) {
  if (!connected) return null
  const view = dotView(state)

  return (
    <button
      type="button"
      className={`sync-dot sync-dot--${view.tone}`}
      role="status"
      aria-label={view.label}
      title={view.label}
      onClick={() => navigate('/settings')}
    />
  )
}

export function AppbarSync() {
  const sync = useSyncOptional()
  if (sync === null) return null
  return <SyncDot state={sync.state} connected={sync.connected} />
}

export function TabBar({ route }: { route: Route }) {
  return (
    <nav className="tabbar" aria-label="주요 화면">
      {TABS.map((tab) => (
        <button
          key={tab.route}
          type="button"
          className={route === tab.route ? 'tab tab--on' : 'tab'}
          onClick={() => navigate(tab.route)}
          aria-current={route === tab.route ? 'page' : undefined}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}

export function InstallBanner() {
  const standalone = useStandalone()
  const sync = useSyncOptional()
  const [dismissed, setDismissed] = useState(false)
  const backedUp = sync?.connected === true

  if (standalone || !isIOS()) return null
  if (backedUp && dismissed) return null

  return (
    <div className={backedUp ? 'banner banner--info' : 'banner banner--blocking'} role="alert">
      <strong>홈 화면에 추가하지 않으면 데이터가 지워집니다.</strong>
      <span>
        {backedUp
          ? 'iOS는 7일간 방문이 없으면 이 앱의 저장소를 삭제합니다. 원본은 저장소에 있으니 다시 이으면 되지만, 그때마다 기기 연결을 새로 해야 합니다. 공유 버튼 → 홈 화면에 추가.'
          : 'iOS는 7일간 방문이 없으면 이 앱의 저장소를 삭제합니다. 지금은 백업이 JSON 내보내기뿐이라 곧 손실입니다. 공유 버튼 → 홈 화면에 추가.'}
      </span>
      {backedUp && (
        <button type="button" onClick={() => setDismissed(true)}>
          닫기
        </button>
      )}
    </div>
  )
}

export function UpdateBanner({ update }: { update: SwUpdate }) {
  if (!update.updateReady) return null
  return (
    <div className="banner banner--info" role="status">
      <span>새 버전이 있습니다.</span>
      <button type="button" onClick={update.applyUpdate}>
        새로고침
      </button>
    </div>
  )
}

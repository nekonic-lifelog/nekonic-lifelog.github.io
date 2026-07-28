import { navigate, type Route } from '../lib/router'
import { isIOS, useStandalone } from '../lib/platform'
import type { SwUpdate } from '../lib/sw'

const TABS: { route: Route; label: string }[] = [
  { route: '/today', label: '오늘' },
  { route: '/todos', label: '할 일' },
  { route: '/records', label: '기록' },
  { route: '/stats', label: '통계' },
]

export function TabBar({ route }: { route: Route }) {
  return (
    <nav className="tabbar">
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
  if (standalone || !isIOS()) return null

  return (
    <div className="banner banner--blocking" role="alert">
      <strong>홈 화면에 추가하지 않으면 데이터가 지워집니다.</strong>
      <span>
        iOS는 7일간 방문이 없으면 이 앱의 저장소를 삭제합니다. 지금은 백업이 JSON
        내보내기뿐이라 곧 손실입니다. 공유 버튼 → 홈 화면에 추가.
      </span>
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

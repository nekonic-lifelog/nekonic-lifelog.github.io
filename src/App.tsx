import { useEffect } from 'react'
import { requestPersistence } from './lib/platform'
import { navigate, useRoute } from './lib/router'
import { useServiceWorker } from './lib/sw'
import { Books } from './screens/Books'
import { DDay } from './screens/DDay'
import { LinkDevice } from './screens/LinkDevice'
import { Records } from './screens/Records'
import { Settings } from './screens/Settings'
import { Stats } from './screens/Stats'
import { Timer } from './screens/Timer'
import { Today } from './screens/Today'
import { Todos } from './screens/Todos'
import { InstallBanner, TabBar, UpdateBanner } from './ui/Shell'
import { useApp } from './state/app'

export function App() {
  const route = useRoute()
  const app = useApp()
  const update = useServiceWorker()

  useEffect(() => {
    requestPersistence()
  }, [])

  return (
    <div className="app">
      <InstallBanner />
      <UpdateBanner update={update} />

      <header className="appbar">
        <button type="button" className="appbar__brand" onClick={() => navigate('/today')}>
          lifelog
        </button>
        <div className="appbar__actions">
          <button type="button" className="link-btn" onClick={() => navigate('/dday')}>
            D-day
          </button>
          <button type="button" className="link-btn" onClick={() => navigate('/timer')}>
            타이머
          </button>
          <button type="button" className="link-btn" onClick={() => navigate('/settings')}>
            설정
          </button>
        </div>
      </header>

      <main className="main">
        {!app.ready ? <p className="empty">불러오는 중…</p> : <Screen route={route} />}
      </main>

      <TabBar route={route} />
    </div>
  )
}

function Screen({ route }: { route: ReturnType<typeof useRoute> }) {
  switch (route) {
    case '/todos':
      return <Todos />
    case '/records':
      return <Records />
    case '/stats':
      return <Stats />
    case '/dday':
      return <DDay />
    case '/books':
      return <Books />
    case '/timer':
      return <Timer />
    case '/link':
      return <LinkDevice />
    case '/settings':
      return <Settings />
    case '/today':
      return <Today />
  }
}

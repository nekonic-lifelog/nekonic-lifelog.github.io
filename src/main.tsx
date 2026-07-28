import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { systemClock } from './lib/clock'
import { IdbStore } from './data/idb'
import { AppProvider } from './state/app'
import { SyncBridge } from './state/bridge'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root를 찾을 수 없습니다')

const store = new IdbStore()

createRoot(root).render(
  <StrictMode>
    <AppProvider store={store} clock={systemClock}>
      <SyncBridge store={store} clock={systemClock}>
        <App />
      </SyncBridge>
    </AppProvider>
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { systemClock } from './lib/clock'
import { IdbStore } from './data/idb'
import { AppProvider } from './state/app'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root를 찾을 수 없습니다')

createRoot(root).render(
  <StrictMode>
    <AppProvider store={new IdbStore()} clock={systemClock}>
      <App />
    </AppProvider>
  </StrictMode>,
)

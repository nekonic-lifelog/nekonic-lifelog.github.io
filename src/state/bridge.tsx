import { useEffect, type ReactNode } from 'react'
import type { Store } from '../data/store'
import type { Clock } from '../lib/clock'
import { useApp } from './app'
import { onDirty } from './dirty'
import { SyncProvider, useSync } from './sync'

export function SyncBridge({
  store,
  clock,
  children,
}: {
  store: Store
  clock: Clock
  children: ReactNode
}) {
  const app = useApp()

  return (
    <SyncProvider store={store} clock={clock} onSnapshot={app.replaceAll}>
      <DirtyPump />
      {children}
    </SyncProvider>
  )
}

function DirtyPump() {
  const sync = useSync()

  useEffect(() => onDirty(() => sync.markDirty()), [sync])

  return null
}

import { useEffect, useState } from 'react'
import { systemClock, type Clock } from './clock'

export interface SwUpdate {
  updateReady: boolean
  applyUpdate(): void
}

export const UPDATE_CHECK_MS = 3_600_000

export interface UpdateGate {
  due(): boolean
}

export function makeUpdateGate(clock: Clock, intervalMs = UPDATE_CHECK_MS): UpdateGate {
  let lastAt: number | null = null
  return {
    due() {
      const now = clock.now()
      if (lastAt !== null && now - lastAt < intervalMs) return false
      lastAt = now
      return true
    },
  }
}

export function useServiceWorker(clock: Clock = systemClock): SwUpdate {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    if (import.meta.env.DEV) return

    let reloading = false
    const onControllerChange = () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    const gate = makeUpdateGate(clock)
    let registration: ServiceWorkerRegistration | null = null

    const recheck = () => {
      if (document.visibilityState !== 'visible') return
      if (registration === null || !gate.due()) return
      void registration.update()
    }

    void navigator.serviceWorker.register('/sw.js').then((reg) => {
      registration = reg
      gate.due()
      if (reg.waiting) setWaiting(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            setWaiting(installing)
          }
        })
      })
    })

    document.addEventListener('visibilitychange', recheck)

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [clock])

  return {
    updateReady: waiting !== null,
    applyUpdate() {
      waiting?.postMessage('SKIP_WAITING')
    },
  }
}

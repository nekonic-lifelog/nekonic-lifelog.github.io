import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useApp } from '../state/app'
import '../styles/projects.css'

const UNDO_MS = 6_000
const TICK_MS = 100

export interface UndoOffer {
  label: string
  run(): void | Promise<void>
}

export interface UndoApi {
  offer(next: UndoOffer): void
  clear(): void
}

const NO_UNDO: UndoApi = {
  offer() {
    return undefined
  },
  clear() {
    return undefined
  },
}

const Ctx = createContext<UndoApi | null>(null)

export function useUndo(): UndoApi {
  return useContext(Ctx) ?? NO_UNDO
}

interface Pending {
  offer: UndoOffer
  expiresAt: number
}

export function UndoProvider({ children }: { children: ReactNode }) {
  const { clock } = useApp()
  const [pending, setPending] = useState<Pending | null>(null)

  const api = useMemo<UndoApi>(
    () => ({
      offer(next) {
        setPending({ offer: next, expiresAt: clock.now() + UNDO_MS })
      },
      clear() {
        setPending(null)
      },
    }),
    [clock],
  )

  useEffect(() => {
    if (!pending) return
    const id = window.setInterval(() => {
      setPending((cur) => (cur && clock.now() >= cur.expiresAt ? null : cur))
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [pending, clock])

  return (
    <Ctx.Provider value={api}>
      {children}
      {pending && (
        <div className="undo-bar" role="status">
          <span className="undo-bar__label">{pending.offer.label}</span>
          <button
            type="button"
            className="undo-bar__btn"
            onClick={() => {
              setPending(null)
              void pending.offer.run()
            }}
          >
            되돌리기
          </button>
        </div>
      )}
    </Ctx.Provider>
  )
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  addPassphrase as addWrap,
  createEnvelope,
  openEnvelope,
  parseEnvelope,
  type Envelope,
} from '../crypto/envelope'
import type { Snapshot, Store } from '../data/store'
import type { Clock } from '../lib/clock'
import { GithubRepo } from '../remote/github'
import {
  idbCredentials,
  idbSyncCache,
  type CredentialStore,
  type Credentials,
  type RemoteConfig,
  type SyncCache,
} from '../sync/credentials'
import { SyncEngine, initialSyncState, type SyncState } from '../sync/engine'

export const ENVELOPE_PATH = 'meta/envelope.json'

export class SyncSetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncSetupError'
  }
}

export interface ConnectInput {
  token: string
  remote: RemoteConfig
  passphrase: string
  acknowledgedNoRecovery?: boolean
}

export interface ConnectWithKeyInput {
  dataKey: CryptoKey
  envelope: Envelope
  token: string
  remote: RemoteConfig
}

export interface SyncApi {
  state: SyncState
  connected: boolean
  connect(input: ConnectInput): Promise<void>
  connectWithKey(input: ConnectWithKeyInput): Promise<void>
  disconnect(): Promise<void>
  resyncAll(): Promise<void>
  addPassphrase(current: string, next: string): Promise<void>
  syncNow(): Promise<void>
  markDirty(): void
  retryAuth(token: string): Promise<void>
}

export interface SyncProviderProps {
  children: ReactNode
  store: Store
  clock: Clock
  credentials?: CredentialStore
  cache?: SyncCache
  makeRepo?(remote: RemoteConfig, token: string): GithubRepo
  onSnapshot?(s: Snapshot): void
  debounceMs?: number
  recentMonths?: number
  autoConnect?: boolean
  autoBackfill?: boolean
}

const Ctx = createContext<SyncApi | null>(null)

export function useSync(): SyncApi {
  const api = useContext(Ctx)
  if (!api) throw new Error('SyncProvider 밖에서 useSync를 불렀습니다')
  return api
}

export function useSyncOptional(): SyncApi | null {
  return useContext(Ctx)
}

function defaultRepo(remote: RemoteConfig, token: string): GithubRepo {
  return new GithubRepo({ ...remote }, token)
}

export function SyncProvider(props: SyncProviderProps) {
  const {
    children,
    store,
    clock,
    credentials,
    cache,
    makeRepo,
    onSnapshot,
    debounceMs,
    recentMonths,
    autoConnect = true,
    autoBackfill = true,
  } = props

  const [state, setState] = useState<SyncState>(initialSyncState)
  const [connected, setConnected] = useState(false)
  const engineRef = useRef<SyncEngine | null>(null)
  const aliveRef = useRef(true)

  const vault = useMemo(() => credentials ?? idbCredentials(), [credentials])
  const syncCache = useMemo(() => cache ?? idbSyncCache(), [cache])
  const build = useMemo(() => makeRepo ?? defaultRepo, [makeRepo])

  const snapshotRef = useRef(onSnapshot)
  snapshotRef.current = onSnapshot

  const start = useCallback(
    async (creds: Credentials) => {
      engineRef.current?.stop()
      const deviceId = await store.deviceId()
      const engine = new SyncEngine({
        store,
        repo: build(creds.remote, creds.token),
        dataKey: creds.dataKey,
        deviceId,
        clock,
        ...(debounceMs === undefined ? {} : { debounceMs }),
        ...(recentMonths === undefined ? {} : { recentMonths }),
        cache: syncCache,
        onState: (s) => {
          if (aliveRef.current) setState(s)
        },
        onSnapshot: (s) => {
          snapshotRef.current?.(s)
        },
      })
      engineRef.current = engine
      setConnected(true)
      setState(engine.state)
      await engine.pull()
      if (engineRef.current !== engine) return
      await engine.push()
      if (!autoBackfill || engineRef.current !== engine) return
      void engine.backfill()
    },
    [store, clock, build, debounceMs, recentMonths, syncCache, autoBackfill],
  )

  useEffect(() => {
    const retry = (): void => {
      const engine = engineRef.current
      if (engine === null || engine.state.authFailed) return
      void engine.syncNow()
    }
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return
      retry()
    }
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    aliveRef.current = true
    if (!autoConnect) return
    void (async () => {
      const saved = await vault.load()
      if (!saved || !aliveRef.current || engineRef.current) return
      await start(saved)
    })()
    return () => {
      aliveRef.current = false
    }
  }, [autoConnect, vault, start])

  useEffect(
    () => () => {
      engineRef.current?.stop()
      engineRef.current = null
    },
    [],
  )

  const api = useMemo<SyncApi>(
    () => ({
      state,
      connected,

      async connect(input) {
        const remote = { ...input.remote }
        const repo = build(remote, input.token)
        const text = await repo.readTextFile(ENVELOPE_PATH)
        let opened
        if (text === null) {
          if (input.acknowledgedNoRecovery !== true) {
            throw new SyncSetupError(
              '이 암호구절을 잃으면 기록을 되살릴 방법이 없습니다. 확인을 먼저 받아야 합니다.',
            )
          }
          opened = await createEnvelope(input.passphrase)
          const bytes = new TextEncoder().encode(
            `${JSON.stringify(opened.envelope, null, 2)}\n`,
          )
          await repo.commitWithRetry(async () => ({
            message: '봉투 만들기',
            put: [{ path: ENVELOPE_PATH, content: bytes }],
          }))
        } else {
          opened = await openEnvelope(parseEnvelope(text), input.passphrase)
        }
        const creds: Credentials = {
          dataKey: opened.dataKey,
          envelope: opened.envelope,
          token: input.token,
          remote,
        }
        await vault.save(creds)
        await start(creds)
      },

      async connectWithKey(input) {
        const creds: Credentials = {
          dataKey: input.dataKey,
          envelope: input.envelope,
          token: input.token,
          remote: { ...input.remote },
        }
        await vault.save(creds)
        await start(creds)
      },

      async disconnect() {
        engineRef.current?.stop()
        engineRef.current = null
        await vault.clear()
        await syncCache.clear()
        setConnected(false)
        setState(initialSyncState())
      },

      async resyncAll() {
        const saved = await vault.load()
        if (saved === null) return
        engineRef.current?.stop()
        engineRef.current = null
        await syncCache.clear()
        setState(initialSyncState())
        await start(saved)
      },

      async addPassphrase(current, next) {
        const saved = await vault.load()
        if (saved === null) {
          throw new SyncSetupError('저장소에 먼저 이어야 암호구절을 더할 수 있습니다.')
        }
        const opened = await openEnvelope(saved.envelope, current)
        const grown = await addWrap(opened.envelope, opened.raw, next)
        const repo = build(saved.remote, saved.token)
        const bytes = new TextEncoder().encode(`${JSON.stringify(grown, null, 2)}\n`)
        await repo.commitWithRetry(async () => ({
          message: '봉투에 암호구절 더하기',
          put: [{ path: ENVELOPE_PATH, content: bytes }],
        }))
        await vault.save({ ...saved, envelope: grown })
      },

      async syncNow() {
        await engineRef.current?.syncNow()
      },

      markDirty() {
        engineRef.current?.markDirty()
      },

      async retryAuth(token) {
        const saved = await vault.load()
        if (!saved) {
          throw new SyncSetupError('아직 연결한 저장소가 없습니다. 먼저 연결하세요.')
        }
        const creds: Credentials = { ...saved, token }
        await vault.save(creds)
        await start(creds)
      },
    }),
    [state, connected, build, vault, start],
  )

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

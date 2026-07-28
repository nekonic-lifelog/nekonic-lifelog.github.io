import { useState } from 'react'
import type { SyncState } from '../sync/engine'
import '../styles/sync.css'

export interface SyncStatusProps {
  state: SyncState
  connected: boolean
  now?: number
  onSyncNow?(): void
  onRetryAuth?(token: string): void
  onConnect?(): void
}

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

export function relativeTime(at: string | null, now: number): string {
  if (at === null) return '아직 없음'
  const ms = Date.parse(at)
  if (Number.isNaN(ms)) return '알 수 없음'
  const gap = now - ms
  if (gap < MINUTE) return '방금'
  if (gap < HOUR) return `${Math.floor(gap / MINUTE)}분 전`
  if (gap < DAY) return `${Math.floor(gap / HOUR)}시간 전`
  return `${Math.floor(gap / DAY)}일 전`
}

function phaseLabel(state: SyncState): string {
  if (state.phase === 'pulling') return '받는 중'
  if (state.phase === 'pushing') return '올리는 중'
  if (state.backfilling) return '지난 기록 채우는 중'
  return '멈춰 있음'
}

export function SyncStatus(props: SyncStatusProps) {
  const { state, connected, onSyncNow, onRetryAuth, onConnect } = props
  const now = props.now ?? Date.now()
  const busy = state.phase === 'pulling' || state.phase === 'pushing'

  if (!connected) {
    return (
      <section className="card sync">
        <div className="card__head">
          <h2>동기화</h2>
          <span className="badge">미연결</span>
        </div>
        <p className="hint">
          아직 저장소에 잇지 않았습니다. 이 기기의 기록은 이 기기에만 남습니다.
        </p>
        {onConnect && (
          <div className="btn-row">
            <button type="button" onClick={onConnect}>
              저장소에 잇기
            </button>
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="card sync">
      <div className="card__head">
        <h2>동기화</h2>
        <span className={busy ? 'badge sync__badge--busy' : 'badge'}>{phaseLabel(state)}</span>
      </div>

      {state.authFailed && <AuthFailed message={state.lastError} onRetryAuth={onRetryAuth} />}

      <dl className="sync__facts">
        <div className="sync__fact">
          <dt>마지막 성공</dt>
          <dd>{relativeTime(state.lastSuccessAt, now)}</dd>
        </div>
        <div className="sync__fact">
          <dt>못 올린 변경</dt>
          <dd>{state.pendingCount === 0 ? '없음' : `${state.pendingCount}건`}</dd>
        </div>
      </dl>

      {state.backfilling && (
        <p className="hint" role="status">
          지난 달치 기록을 배경에서 채우는 중입니다.
        </p>
      )}

      {!state.authFailed && state.lastError !== null && (
        <p className="msg msg--error">{state.lastError}</p>
      )}

      {onSyncNow && (
        <div className="btn-row">
          <button type="button" onClick={onSyncNow} disabled={busy || state.authFailed}>
            지금 동기화
          </button>
        </div>
      )}
    </section>
  )
}

function AuthFailed({
  message,
  onRetryAuth,
}: {
  message: string | null
  onRetryAuth?: ((token: string) => void) | undefined
}) {
  const [token, setToken] = useState('')

  return (
    <div className="banner banner--blocking sync__alarm" role="alert">
      <strong>동기화가 멈췄습니다</strong>
      <span>{message ?? 'GitHub 토큰이 더 이상 통하지 않습니다.'}</span>
      <span>새 토큰을 넣기 전까지 이 기기의 기록은 다른 기기로 넘어가지 않습니다.</span>
      {onRetryAuth && (
        <form
          className="sync__retry"
          onSubmit={(e) => {
            e.preventDefault()
            onRetryAuth(token.trim())
            setToken('')
          }}
        >
          <label className="field sync__field">
            <span>새 GitHub 토큰</span>
            <input
              type="password"
              value={token}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setToken(e.target.value)}
              aria-label="새 GitHub 토큰"
            />
          </label>
          <div className="btn-row">
            <button type="submit" disabled={token.trim() === ''}>
              토큰 다시 넣기
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

import { useState } from 'react'
import type { SyncDirection, SyncEvent, SyncOutcome, SyncState } from '../sync/engine'
import type { Clash } from '../sync/merge'
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
  if (state.backfilling !== null) return '지난 기록 채우는 중'
  return '멈춰 있음'
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function stampOf(at: string): string {
  const ms = Date.parse(at)
  if (Number.isNaN(ms)) return '알 수 없음'
  const d = new Date(ms)
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function directionLabel(direction: SyncDirection): string {
  return direction === 'pull' ? '받기' : '올리기'
}

export function outcomeLabel(outcome: SyncOutcome): string {
  if (outcome === 'ok') return '성공'
  if (outcome === 'partial') return '일부 실패'
  return '실패'
}

export function eventSentence(event: SyncEvent): string {
  const parts = [
    stampOf(event.at),
    directionLabel(event.direction),
    outcomeLabel(event.outcome),
    `읽은 파일 ${event.read}개`,
    `올린 파일 ${event.wrote}개`,
  ]
  if (event.skipped > 0) parts.push(`건너뛴 파일 ${event.skipped}개`)
  if (event.error !== null) parts.push(event.error)
  return parts.join(' · ')
}

export function clashSentence(clash: Clash): string {
  return `${clash.table} ${clash.id} — ${clash.winnerDeviceId} 쪽이 남고 ${clash.loserDeviceId}가 ${stampOf(clash.loserUpdatedAt)}에 고친 것이 밀렸습니다`
}

function BackfillLine({ done, total }: { done: number; total: number }) {
  const text = total === 0 ? '지난 기록을 배경에서 채우는 중입니다.' : `지난 기록 ${total}개 가운데 ${done}개를 받았습니다.`
  return (
    <p className="hint" role="status">
      {text}
    </p>
  )
}

function History({ history }: { history: SyncEvent[] }) {
  if (history.length === 0) return null
  return (
    <details className="sync__fold">
      <summary>동기화 이력 {history.length}건</summary>
      <ol className="sync__log">
        {history.map((event, i) => (
          <li
            className="sync__log-row"
            key={`${event.at}-${event.direction}-${i}`}
            aria-label={eventSentence(event)}
          >
            <span className="sync__log-when">{stampOf(event.at)}</span>
            <span className={`sync__tag sync__tag--${event.outcome}`}>
              {directionLabel(event.direction)} · {outcomeLabel(event.outcome)}
            </span>
            <span className="sync__log-counts">
              읽음 {event.read} · 올림 {event.wrote}
              {event.skipped > 0 ? ` · 건너뜀 ${event.skipped}` : ''}
            </span>
            {event.error !== null && <span className="sync__log-error">{event.error}</span>}
          </li>
        ))}
      </ol>
    </details>
  )
}

function Clashes({ clashes }: { clashes: Clash[] }) {
  if (clashes.length === 0) return null
  return (
    <details className="sync__fold">
      <summary>최근 겹친 편집 {clashes.length}건</summary>
      <ul className="sync__log">
        {clashes.map((clash, i) => (
          <li
            className="sync__log-row"
            key={`${clash.table}-${clash.id}-${clash.loserUpdatedAt}-${i}`}
            aria-label={clashSentence(clash)}
          >
            <span className="sync__log-when">
              {clash.table} · {clash.id}
            </span>
            <span className="sync__log-counts">
              {clash.winnerDeviceId} 쪽이 남음 · {clash.loserDeviceId}가 {stampOf(clash.loserUpdatedAt)}에 고친 것이 밀림
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
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
        <div className="sync__fact">
          <dt>건너뛴 파일</dt>
          <dd>{state.skipped.length === 0 ? '없음' : `${state.skipped.length}개`}</dd>
        </div>
      </dl>

      {state.backfilling !== null && (
        <BackfillLine done={state.backfilling.done} total={state.backfilling.total} />
      )}

      {!state.authFailed && state.lastError !== null && (
        <p className="msg msg--error">{state.lastError}</p>
      )}

      <Clashes clashes={state.clashes} />
      <History history={state.history} />

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

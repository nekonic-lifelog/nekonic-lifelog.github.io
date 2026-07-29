import { useState } from 'react'
import { navigate } from '../lib/router'
import { useSyncOptional } from '../state/sync'
import type { RemoteConfig } from '../sync/credentials'
import { SyncStatus } from '../ui/SyncStatus'

const DEFAULT_BRANCH = 'main'

function reason(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return '알 수 없는 문제가 생겼습니다.'
}

export function SyncSettings() {
  const sync = useSyncOptional()
  const [open, setOpen] = useState(false)

  if (!sync) return null

  return (
    <>
      <SyncStatus
        state={sync.state}
        connected={sync.connected}
        onSyncNow={() => void sync.syncNow()}
        onRetryAuth={(token) => void sync.retryAuth(token)}
        onConnect={() => setOpen(true)}
      />

      {(open || sync.connected) && (
        <section className="card">
          <div className="card__head">
            <h2>저장소</h2>
            {sync.connected && (
              <button
                type="button"
                className="link-btn"
                onClick={() => void sync.disconnect()}
              >
                연결 끊기
              </button>
            )}
          </div>

          <p className="hint">
            기록은 개인 저장소에 암호화되어 올라갑니다. 앱은 이 기기에서 바로 열리고,
            잠금 화면은 없습니다.
          </p>

          {!sync.connected && <ConnectForm onDone={() => setOpen(false)} />}

          <div className="btn-row">
            <button type="button" className="link-btn" onClick={() => navigate('/link')}>
              기기 연결 (QR · 수동 입력)
            </button>
          </div>

          {sync.connected && <ResyncRow onResync={() => void sync.resyncAll()} />}
          {sync.connected && <PassphraseRow onAdd={(a, b) => sync.addPassphrase(a, b)} />}
        </section>
      )}
    </>
  )
}

function ResyncRow({ onResync }: { onResync(): void }) {
  const [asking, setAsking] = useState(false)

  if (!asking) {
    return (
      <div className="btn-row">
        <button type="button" className="link-btn" onClick={() => setAsking(true)}>
          전부 다시 받기
        </button>
      </div>
    )
  }

  return (
    <div className="resync">
      <p className="hint">
        이미 읽었다는 표시를 지우고 저장소를 처음부터 다시 읽습니다. 이 기기에 있는 기록은
        지우지 않습니다. 폰에는 있는데 이 기기에 안 보이는 것이 있을 때 씁니다.
      </p>
      <div className="btn-row">
        <button
          type="button"
          onClick={() => {
            setAsking(false)
            onResync()
          }}
        >
          다시 받기
        </button>
        <button type="button" onClick={() => setAsking(false)}>
          취소
        </button>
      </div>
    </div>
  )
}

function PassphraseRow({ onAdd }: { onAdd(current: string, next: string): Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const submit = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await onAdd(current, next)
      setMessage({
        kind: 'ok',
        text: '더했습니다. 새 암호구절로 한 번 열어보고 나서 옛 것을 버리세요.',
      })
      setCurrent('')
      setNext('')
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : '더하지 못했습니다.',
      })
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="btn-row">
        <button type="button" className="link-btn" onClick={() => setOpen(true)}>
          암호구절 더하기
        </button>
      </div>
    )
  }

  return (
    <form
      className="resync"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <p className="hint">
        암호구절은 모든 기기가 막혔을 때 쓰는 마지막 열쇠입니다. 새 것을 먼저 더해 두고,
        실제로 열리는지 확인한 뒤에 옛 것을 버리세요. 이 순서를 지키면 중간에 실패해도
        잠기지 않습니다.
      </p>
      <input
        type="password"
        value={current}
        placeholder="지금 쓰는 암호구절"
        onChange={(e) => setCurrent(e.target.value)}
        aria-label="지금 쓰는 암호구절"
      />
      <input
        type="password"
        value={next}
        placeholder="더할 암호구절"
        onChange={(e) => setNext(e.target.value)}
        aria-label="더할 암호구절"
      />
      <div className="btn-row">
        <button type="submit" disabled={busy || !current || !next}>
          {busy ? '더하는 중…' : '더하기'}
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          닫기
        </button>
      </div>
      {message && (
        <p className={message.kind === 'error' ? 'msg msg--error' : 'msg msg--ok'}>
          {message.text}
        </p>
      )}
    </form>
  )
}

function ConnectForm({ onDone }: { onDone(): void }) {
  const sync = useSyncOptional()
  const [token, setToken] = useState('')
  const [owner, setOwner] = useState('')
  const [repo, setRepo] = useState('')
  const [branch, setBranch] = useState(DEFAULT_BRANCH)
  const [passphrase, setPassphrase] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!sync) return null

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const remote: RemoteConfig = {
        owner: owner.trim(),
        repo: repo.trim(),
        branch: branch.trim() || DEFAULT_BRANCH,
      }
      await sync.connect({
        token: token.trim(),
        remote,
        passphrase,
        acknowledgedNoRecovery: acknowledged,
      })
      setToken('')
      setPassphrase('')
      onDone()
    } catch (err) {
      setError(reason(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="composer">
      <label className="field">
        <span>저장소 소유자</span>
        <input value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="저장소 소유자" />
      </label>
      <label className="field">
        <span>저장소 이름</span>
        <input value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="저장소 이름" />
      </label>
      <label className="field">
        <span>브랜치</span>
        <input value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="브랜치" />
      </label>
      <label className="field">
        <span>토큰</span>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          aria-label="토큰"
        />
      </label>
      <label className="field">
        <span>암호구절</span>
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="off"
          aria-label="암호구절"
        />
      </label>

      <p className="hint">
        암호구절은 비밀번호 관리자에 저장하세요. <strong>찾기 기능은 없습니다.</strong>{' '}
        암호구절을 잃고 모든 기기의 저장분까지 사라지면 기록은 영구히 사라집니다.
      </p>

      <label className="field">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        <span>되찾을 방법이 없다는 것을 이해했습니다</span>
      </label>

      {error !== null && <p className="msg msg--error">{error}</p>}

      <div className="btn-row">
        <button type="button" onClick={() => void submit()} disabled={busy}>
          {busy ? '잇는 중…' : '저장소에 잇기'}
        </button>
      </div>
    </div>
  )
}

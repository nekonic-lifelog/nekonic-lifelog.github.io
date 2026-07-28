import { useEffect, useRef, useState } from 'react'
import { CameraError, cameraAvailable, startScan, type ScanHandle } from '../link/camera'
import {
  LinkError,
  decodeLinkPayload,
  encodeLinkPayload,
  type LinkPayload,
} from '../link/payload'
import { renderQrToCanvas } from '../link/qr'
import '../styles/link.css'

const REVEAL_SECONDS = 30

export interface LinkScreenProps {
  deviceId: string
  buildPayload(passphrase: string): Promise<LinkPayload>
  acceptPayload(p: LinkPayload): Promise<void>
  acceptManual(input: {
    token: string
    owner: string
    repo: string
    branch: string
    passphrase: string
  }): Promise<void>
}

type Side = 'issue' | 'receive'

function reason(err: unknown): string {
  if (err instanceof LinkError || err instanceof CameraError) return err.message
  if (err instanceof Error && err.message) return err.message
  return '알 수 없는 문제가 생겼습니다.'
}

export function Link(props: LinkScreenProps) {
  const [side, setSide] = useState<Side>('receive')

  return (
    <div className="screen">
      <h1 className="screen__title">기기 연결</h1>
      <p className="hint">
        기기 ID <code>{props.deviceId || '—'}</code>
      </p>

      <div className="btn-row link-tabs">
        <button
          type="button"
          className={side === 'receive' ? 'link-tab link-tab--on' : 'link-tab'}
          aria-pressed={side === 'receive'}
          onClick={() => setSide('receive')}
        >
          이 기기를 잇기
        </button>
        <button
          type="button"
          className={side === 'issue' ? 'link-tab link-tab--on' : 'link-tab'}
          aria-pressed={side === 'issue'}
          onClick={() => setSide('issue')}
        >
          다른 기기에 넘기기
        </button>
      </div>

      {side === 'issue' ? (
        <IssueSide buildPayload={props.buildPayload} />
      ) : (
        <ReceiveSide acceptPayload={props.acceptPayload} acceptManual={props.acceptManual} />
      )}
    </div>
  )
}

function IssueSide({ buildPayload }: Pick<LinkScreenProps, 'buildPayload'>) {
  const [passphrase, setPassphrase] = useState('')
  const [text, setText] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [left, setLeft] = useState(REVEAL_SECONDS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!revealed) return
    const id = window.setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000)
    return () => window.clearInterval(id)
  }, [revealed])

  useEffect(() => {
    if (revealed && left <= 0) setRevealed(false)
  }, [revealed, left])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!revealed || !text || !canvas) return
    let alive = true
    void renderQrToCanvas(canvas, text).catch((err: unknown) => {
      if (alive) setError(reason(err))
    })
    return () => {
      alive = false
    }
  }, [revealed, text])

  const build = async () => {
    setError(null)
    setBusy(true)
    try {
      const payload = await buildPayload(passphrase)
      setText(encodeLinkPayload(payload))
      setPassphrase('')
      setLeft(REVEAL_SECONDS)
      setRevealed(false)
    } catch (err) {
      setText(null)
      setError(reason(err))
    } finally {
      setBusy(false)
    }
  }

  const forget = () => {
    setText(null)
    setRevealed(false)
    setLeft(REVEAL_SECONDS)
    setError(null)
  }

  return (
    <section className="card">
      <div className="card__head">
        <h2>연결 QR 만들기</h2>
        <span className="badge">보내는 쪽</span>
      </div>

      <p className="link-warn">
        이 QR에는 데이터를 여는 열쇠와 GitHub 토큰이 그대로 들어 있습니다. 화면을 캡처하거나
        사진으로 남기지 말고, 새 기기의 카메라로만 읽으세요.
      </p>

      {text === null ? (
        <form
          className="link-form"
          onSubmit={(e) => {
            e.preventDefault()
            void build()
          }}
        >
          <label className="field link-field">
            <span>암호구절</span>
            <input
              type="password"
              value={passphrase}
              autoComplete="off"
              onChange={(e) => setPassphrase(e.target.value)}
              aria-label="암호구절"
            />
          </label>
          <p className="hint">
            지금 쓰는 암호구절로 잠금을 풀어야 QR을 만들 수 있습니다.
          </p>
          <div className="btn-row">
            <button type="submit" disabled={busy || passphrase === ''}>
              {busy ? '만드는 중…' : 'QR 만들기'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="link-qr">
            {revealed ? (
              <canvas ref={canvasRef} className="link-qr__canvas" aria-label="기기 연결 QR" />
            ) : (
              <button
                type="button"
                className="link-qr__cover"
                onClick={() => {
                  setLeft(REVEAL_SECONDS)
                  setRevealed(true)
                }}
              >
                눌러서 {REVEAL_SECONDS}초 동안 보기
              </button>
            )}
          </div>
          {revealed && (
            <p className="hint" role="status">
              {left}초 뒤에 자동으로 가립니다.
            </p>
          )}
          <div className="btn-row">
            {revealed && (
              <button type="button" onClick={() => setRevealed(false)}>
                지금 가리기
              </button>
            )}
            <button type="button" className="danger" onClick={forget}>
              QR 버리기
            </button>
          </div>
        </>
      )}

      {error && <p className="msg msg--error">{error}</p>}
    </section>
  )
}

function ReceiveSide({
  acceptPayload,
  acceptManual,
}: Pick<LinkScreenProps, 'acceptPayload' | 'acceptManual'>) {
  return (
    <>
      <ScanCard acceptPayload={acceptPayload} />
      <ManualCard acceptManual={acceptManual} />
    </>
  )
}

function ScanCard({ acceptPayload }: Pick<LinkScreenProps, 'acceptPayload'>) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const handleRef = useRef<ScanHandle | null>(null)
  const busyRef = useRef(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(
    () => () => {
      handleRef.current?.stop()
      handleRef.current = null
    },
    [],
  )

  const stop = () => {
    handleRef.current?.stop()
    handleRef.current = null
    setScanning(false)
  }

  const onText = (text: string) => {
    if (busyRef.current) return
    busyRef.current = true
    void (async () => {
      try {
        const payload = decodeLinkPayload(text)
        await acceptPayload(payload)
        stop()
        setError(null)
        setDone(true)
      } catch (err) {
        setError(reason(err))
      } finally {
        busyRef.current = false
      }
    })()
  }

  const begin = async () => {
    const video = videoRef.current
    if (!video) return
    setError(null)
    setDone(false)
    try {
      handleRef.current = await startScan(video, onText)
      setScanning(true)
    } catch (err) {
      setScanning(false)
      setError(reason(err))
    }
  }

  return (
    <section className="card">
      <div className="card__head">
        <h2>QR로 잇기</h2>
        <span className="badge">받는 쪽</span>
      </div>
      <p className="hint">
        기존 기기의 연결 화면에서 QR을 띄운 뒤, 이 기기의 카메라로 비추세요.
      </p>

      <div className={scanning ? 'link-cam link-cam--on' : 'link-cam'}>
        <video ref={videoRef} className="link-cam__video" playsInline muted />
      </div>

      <div className="btn-row">
        {scanning ? (
          <button type="button" onClick={stop}>
            스캔 멈추기
          </button>
        ) : (
          <button type="button" onClick={() => void begin()}>
            카메라 켜기
          </button>
        )}
      </div>

      {!cameraAvailable() && (
        <p className="hint">
          이 기기에서는 카메라를 쓸 수 없어 보입니다. 아래 수동 입력으로 이으세요.
        </p>
      )}
      {done && <p className="msg msg--ok">읽었습니다. 이 기기를 이었습니다.</p>}
      {error && <p className="msg msg--error">{error}</p>}
    </section>
  )
}

function ManualCard({ acceptManual }: Pick<LinkScreenProps, 'acceptManual'>) {
  const [token, setToken] = useState('')
  const [owner, setOwner] = useState('')
  const [repo, setRepo] = useState('')
  const [branch, setBranch] = useState('main')
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const ready =
    token.trim() !== '' &&
    owner.trim() !== '' &&
    repo.trim() !== '' &&
    branch.trim() !== '' &&
    passphrase !== ''

  const submit = async () => {
    setError(null)
    setDone(false)
    setBusy(true)
    try {
      await acceptManual({
        token: token.trim(),
        owner: owner.trim(),
        repo: repo.trim(),
        branch: branch.trim(),
        passphrase,
      })
      setToken('')
      setPassphrase('')
      setDone(true)
    } catch (err) {
      setError(reason(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card__head">
        <h2>손으로 입력해서 잇기</h2>
        <span className="badge">받는 쪽</span>
      </div>
      <p className="hint">
        카메라를 쓰지 않아도 됩니다. 토큰과 레포, 암호구절만 있으면 같은 자리로 이어집니다.
        이 길로 이으면 기기 ID는 새로 발급됩니다.
      </p>

      <form
        className="link-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="field link-field">
          <span>GitHub 토큰</span>
          <input
            type="password"
            value={token}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setToken(e.target.value)}
            aria-label="GitHub 토큰"
          />
        </label>
        <label className="field link-field">
          <span>소유자</span>
          <input
            type="text"
            value={owner}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setOwner(e.target.value)}
            aria-label="소유자"
          />
        </label>
        <label className="field link-field">
          <span>레포 이름</span>
          <input
            type="text"
            value={repo}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setRepo(e.target.value)}
            aria-label="레포 이름"
          />
        </label>
        <label className="field link-field">
          <span>브랜치</span>
          <input
            type="text"
            value={branch}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setBranch(e.target.value)}
            aria-label="브랜치"
          />
        </label>
        <label className="field link-field">
          <span>암호구절</span>
          <input
            type="password"
            value={passphrase}
            autoComplete="off"
            onChange={(e) => setPassphrase(e.target.value)}
            aria-label="암호구절"
          />
        </label>
        <div className="btn-row">
          <button type="submit" disabled={busy || !ready}>
            {busy ? '잇는 중…' : '잇기'}
          </button>
        </div>
      </form>

      {done && <p className="msg msg--ok">이었습니다.</p>}
      {error && <p className="msg msg--error">{error}</p>}
    </section>
  )
}

import { useEffect, useRef, useState } from 'react'
import { beep } from '../lib/beep'
import { systemClock } from '../lib/clock'
import {
  formatRemaining,
  idleTimer,
  pause,
  reset,
  resume,
  setDuration,
  start,
  tick,
  type TimerState,
} from '../lib/timer'
import '../styles/timer.css'

const PRESETS = [1, 3, 5, 10, 25, 60]
const DEFAULT_MINUTES = 5
const TICK_MS = 100

export function Timer() {
  const [state, setState] = useState<TimerState>(() => idleTimer(DEFAULT_MINUTES * 60_000))
  const [minutes, setMinutes] = useState(String(DEFAULT_MINUTES))
  const [seconds, setSeconds] = useState('0')
  const rang = useRef(false)

  useEffect(() => {
    if (state.phase !== 'running') return
    const id = window.setInterval(() => {
      setState((s) => tick(s, systemClock.now()))
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [state.phase])

  useEffect(() => {
    if (state.phase !== 'done') {
      rang.current = false
      return
    }
    if (rang.current) return
    rang.current = true
    beep()
  }, [state.phase])

  const applyPreset = (min: number) => {
    setMinutes(String(min))
    setSeconds('0')
    setState((s) => setDuration(s, min * 60_000))
  }

  const applyCustom = () => {
    const m = Number(minutes)
    const s = Number(seconds)
    const total =
      (Number.isFinite(m) ? Math.max(0, Math.floor(m)) : 0) * 60_000 +
      (Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 0) * 1000
    if (total <= 0) return
    setState((prev) => setDuration(prev, total))
  }

  const primary =
    state.phase === 'running'
      ? { label: '일시정지', run: () => setState((s) => pause(s, systemClock.now())) }
      : state.phase === 'paused'
        ? { label: '재개', run: () => setState((s) => resume(s, systemClock.now())) }
        : { label: '시작', run: () => setState((s) => start(s, systemClock.now())) }

  return (
    <div className="screen">
      <h1 className="screen__title">타이머</h1>

      <section className={state.phase === 'done' ? 'card timer-card timer-card--done' : 'card timer-card'}>
        <div className="timer-display" role="timer" aria-label="남은 시간">
          {formatRemaining(state.remainingMs)}
        </div>
        <p className="timer-phase" role="status">
          {state.phase === 'done'
            ? '시간이 다 되었습니다.'
            : state.phase === 'paused'
              ? '일시정지됨'
              : state.phase === 'running'
                ? '진행 중'
                : '대기 중'}
        </p>
        <div className="btn-row timer-controls">
          <button
            type="button"
            className="timer-primary"
            onClick={primary.run}
            disabled={state.remainingMs <= 0 && state.durationMs <= 0}
          >
            {primary.label}
          </button>
          <button type="button" onClick={() => setState(reset)}>
            리셋
          </button>
        </div>
      </section>

      <section className="card">
        <h2>빠른 설정</h2>
        <div className="btn-row timer-presets">
          {PRESETS.map((min) => (
            <button
              key={min}
              type="button"
              className={
                state.durationMs === min * 60_000 ? 'timer-preset timer-preset--on' : 'timer-preset'
              }
              onClick={() => applyPreset(min)}
              aria-pressed={state.durationMs === min * 60_000}
            >
              {min}분
            </button>
          ))}
        </div>

        <form
          className="btn-row timer-custom"
          onSubmit={(e) => {
            e.preventDefault()
            applyCustom()
          }}
        >
          <label className="field">
            분
            <input
              type="number"
              min="0"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              aria-label="분"
            />
          </label>
          <label className="field">
            초
            <input
              type="number"
              min="0"
              max="59"
              value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
              aria-label="초"
            />
          </label>
          <button type="submit">설정</button>
        </form>
      </section>

      <p className="hint">
        앱이 열려 있을 때만 소리가 납니다. 화면이 꺼지거나 앱을 닫으면 울리지 않습니다.
      </p>
    </div>
  )
}

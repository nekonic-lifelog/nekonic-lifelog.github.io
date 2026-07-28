export type TimerPhase = 'idle' | 'running' | 'paused' | 'done'

export interface TimerState {
  phase: TimerPhase
  durationMs: number
  remainingMs: number
  endsAt: number | null
}

function normalize(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0
  return Math.floor(durationMs)
}

export function idleTimer(durationMs: number): TimerState {
  const ms = normalize(durationMs)
  return { phase: 'idle', durationMs: ms, remainingMs: ms, endsAt: null }
}

export function start(state: TimerState, now: number): TimerState {
  if (state.phase === 'running') return state
  const base = state.phase === 'done' ? state.durationMs : state.remainingMs
  if (base <= 0) return state
  return { ...state, phase: 'running', remainingMs: base, endsAt: now + base }
}

export function pause(state: TimerState, now: number): TimerState {
  if (state.phase !== 'running') return state
  const ticked = tick(state, now)
  if (ticked.phase !== 'running') return ticked
  return { ...ticked, phase: 'paused', endsAt: null }
}

export function resume(state: TimerState, now: number): TimerState {
  if (state.phase !== 'paused') return state
  if (state.remainingMs <= 0) return state
  return { ...state, phase: 'running', endsAt: now + state.remainingMs }
}

export function reset(state: TimerState): TimerState {
  return idleTimer(state.durationMs)
}

export function setDuration(state: TimerState, durationMs: number): TimerState {
  const ms = normalize(durationMs)
  if (state.phase === 'idle' && state.durationMs === ms && state.remainingMs === ms) return state
  return idleTimer(ms)
}

export function tick(state: TimerState, now: number): TimerState {
  if (state.phase !== 'running' || state.endsAt === null) return state
  const left = state.endsAt - now
  if (left <= 0) return { ...state, phase: 'done', remainingMs: 0, endsAt: null }
  if (left === state.remainingMs) return state
  return { ...state, remainingMs: left }
}

export function formatRemaining(ms: number): string {
  const total = ms > 0 ? Math.ceil(ms / 1000) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`
  return `${minutes}:${pad(seconds)}`
}

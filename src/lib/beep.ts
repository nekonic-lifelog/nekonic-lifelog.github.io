type AudioCtor = new () => AudioContext

let shared: AudioContext | null = null

function contextCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null
  const holder = window as unknown as {
    AudioContext?: AudioCtor
    webkitAudioContext?: AudioCtor
  }
  return holder.AudioContext ?? holder.webkitAudioContext ?? null
}

function context(): AudioContext | null {
  if (shared) return shared
  const Ctor = contextCtor()
  if (!Ctor) return null
  shared = new Ctor()
  return shared
}

function blip(ctx: AudioContext, at: number, freq: number): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(at)
  osc.stop(at + 0.24)
}

export function beep(): void {
  try {
    const ctx = context()
    if (!ctx) return
    const resumed = ctx.resume?.()
    if (resumed && typeof resumed.catch === 'function') resumed.catch(() => undefined)
    const at = ctx.currentTime
    blip(ctx, at, 880)
    blip(ctx, at + 0.3, 1174)
    blip(ctx, at + 0.6, 880)
  } catch {
    shared = null
  }
}

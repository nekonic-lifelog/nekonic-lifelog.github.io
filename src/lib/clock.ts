export interface Clock {
  now(): number
}

export const systemClock: Clock = {
  now: () => Date.now(),
}

export function fixedClock(at: string | number | Date): Clock {
  const ms = at instanceof Date ? at.getTime() : new Date(at).getTime()
  if (Number.isNaN(ms)) throw new Error(`fixedClock: 해석할 수 없는 시각 ${String(at)}`)
  return { now: () => ms }
}

export function mutableClock(at: string | number | Date) {
  let ms = at instanceof Date ? at.getTime() : new Date(at).getTime()
  return {
    now: () => ms,
    set(next: string | number | Date) {
      ms = next instanceof Date ? next.getTime() : new Date(next).getTime()
    },
    advanceHours(h: number) {
      ms += h * 3_600_000
    },
    advanceDays(d: number) {
      ms += d * 86_400_000
    },
  }
}

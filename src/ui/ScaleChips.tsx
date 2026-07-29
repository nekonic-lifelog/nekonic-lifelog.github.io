const MAX_CHIPS = 20

export interface ScaleChipsProps {
  name: string
  min: number
  max: number
  unit?: string | undefined
  selected: number | null
  onPick(value: number): void
}

export function scaleValues(min: number, max: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  const lo = Math.round(min)
  const hi = Math.round(max)
  if (hi < lo || hi - lo + 1 > MAX_CHIPS) return []
  const values: number[] = []
  for (let v = lo; v <= hi; v++) values.push(v)
  return values
}

export function ScaleChips({ name, min, max, unit, selected, onPick }: ScaleChipsProps) {
  const values = scaleValues(min, max)
  const suffix = unit ? ` ${unit}` : ''

  return (
    <div className="scale-chips" role="group" aria-label={`${name} 값 고르기`}>
      {values.map((value) => (
        <button
          key={value}
          type="button"
          className={value === selected ? 'scale-chip scale-chip--on' : 'scale-chip'}
          aria-pressed={value === selected}
          aria-label={`${name} ${value}${suffix} 기록`}
          onClick={() => onPick(value)}
        >
          {value}
        </button>
      ))}
    </div>
  )
}

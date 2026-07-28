import { useMemo, useState } from 'react'
import {
  isPresetAdded,
  presetGroups,
  presetSummary,
  type DefinitionPreset,
} from '../lib/presets'

export interface PresetPickerProps {
  existingNames: string[]
  onAdd(preset: DefinitionPreset): Promise<void>
}

export function PresetPicker({ existingNames, onAdd }: PresetPickerProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const groups = useMemo(() => presetGroups(), [])

  const add = (preset: DefinitionPreset) => {
    if (busy !== null) return
    setBusy(preset.key)
    void onAdd(preset).finally(() => setBusy(null))
  }

  return (
    <div className="composer">
      <p className="hint">
        자주 쓰는 것들입니다. 누르면 습관 정의로 추가되고, 그다음부터는 오늘 화면에서
        체크하거나 양을 적으면 됩니다.
      </p>
      {groups.map(({ group, presets }) => (
        <div key={group} className="composer__row">
          <span className="badge">{group}</span>
          <div className="btn-row">
            {presets.map((preset) => {
              const added = isPresetAdded(preset, existingNames)
              return (
                <button
                  key={preset.key}
                  type="button"
                  disabled={added || busy === preset.key}
                  aria-label={`${preset.label} 추가`}
                  title={presetSummary(preset)}
                  onClick={() => add(preset)}
                >
                  {added ? `${preset.label} · 추가됨` : `+ ${preset.label}`}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

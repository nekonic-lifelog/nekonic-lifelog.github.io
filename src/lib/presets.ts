import type { DefinitionKind } from './types'

export interface DefinitionPreset {
  key: string
  label: string
  group: string
  kind: DefinitionKind
  unit?: string | undefined
  target?: number | undefined
}

export interface PresetGroup {
  group: string
  presets: DefinitionPreset[]
}

export interface PresetDefinitionInput {
  name: string
  kind: DefinitionKind
  unit?: string | undefined
  target?: number | undefined
}

export const DEFINITION_PRESETS: DefinitionPreset[] = [
  { key: 'med-morning', label: '아침 약', group: '약', kind: 'check' },
  { key: 'med-evening', label: '저녁 약', group: '약', kind: 'check' },
  { key: 'supp-vitamin-d', label: '비타민 D', group: '영양제', kind: 'check' },
  { key: 'supp-omega-3', label: '오메가3', group: '영양제', kind: 'check' },
  { key: 'supp-magnesium', label: '마그네슘', group: '영양제', kind: 'check' },
  { key: 'water', label: '물', group: '음료', kind: 'quantity', unit: 'ml', target: 2000 },
  { key: 'caffeine', label: '카페인', group: '음료', kind: 'quantity', unit: 'mg', target: 400 },
  { key: 'exercise', label: '운동', group: '운동', kind: 'check' },
]

export function presetGroups(presets: DefinitionPreset[] = DEFINITION_PRESETS): PresetGroup[] {
  const groups: PresetGroup[] = []
  for (const preset of presets) {
    const found = groups.find((g) => g.group === preset.group)
    if (found) found.presets.push(preset)
    else groups.push({ group: preset.group, presets: [preset] })
  }
  return groups
}

export function presetDefinitionInput(preset: DefinitionPreset): PresetDefinitionInput {
  return {
    name: preset.label,
    kind: preset.kind,
    unit: preset.kind === 'quantity' ? preset.unit : undefined,
    target: preset.kind === 'quantity' ? preset.target : undefined,
  }
}

export function isPresetAdded(preset: DefinitionPreset, existingNames: string[]): boolean {
  return existingNames.some((name) => name.trim() === preset.label)
}

export function presetSummary(preset: DefinitionPreset): string {
  if (preset.kind === 'check') return '체크'
  const unit = preset.unit ?? ''
  return preset.target !== undefined ? `하루 ${preset.target}${unit}` : `수량 ${unit}`.trim()
}

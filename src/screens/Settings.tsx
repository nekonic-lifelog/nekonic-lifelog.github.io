import { useEffect, useMemo, useRef, useState } from 'react'
import { BackupError, parseBackup, serializeBackup } from '../lib/backup'
import { weekdayLabel } from '../lib/day'
import { managedDefinitions } from '../lib/select'
import { effectiveTarget } from '../lib/streak'
import type { Definition, DefinitionKind } from '../lib/types'
import { useApp } from '../state/app'
import { useHabits, type NewDefinition } from '../state/habits'
import { presetDefinitionInput, type DefinitionPreset } from '../lib/presets'
import { PresetPicker } from '../ui/PresetPicker'
import { ReminderSettings } from './ReminderSettings'
import { SyncSettings } from './SyncSettings'

export function Settings() {
  const app = useApp()

  return (
    <div className="screen">
      <h1 className="screen__title">설정</h1>
      <SyncSettings />
      <ReminderSettings />
      <BackupSection />
      <DefinitionsSection />
      <DayBoundarySection />
      <section className="card">
        <h2>기기</h2>
        <p className="hint">
          기기 ID <code>{app.deviceId || '—'}</code>
        </p>
        <p className="hint">
          <a href="/check.html">환경 점검 열기</a> — 이 기기가 어떤 기능을 지원하는지
          확인합니다. 앱 데이터는 건드리지 않습니다.
        </p>
      </section>
    </div>
  )
}

function BackupSection() {
  const app = useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const exportJson = () => {
    const json = serializeBackup(app.snapshot, app.clock)
    const stamp = new Date(app.clock.now()).toISOString().slice(0, 10)
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `lifelog-${stamp}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMessage({ kind: 'ok', text: '내보냈습니다.' })
  }

  const importJson = async (file: File) => {
    setMessage(null)
    try {
      const parsed = parseBackup(await file.text())
      const counts = `습관 ${parsed.data.definitions.length} · 기록 ${parsed.data.records.length} · 할 일 ${parsed.data.todos.length}`
      if (!window.confirm(`현재 데이터를 전부 지우고 불러온 내용으로 바꿉니다.\n\n${counts}\n\n계속할까요?`)) {
        return
      }
      await app.replaceAll(parsed.data)
      setMessage({ kind: 'ok', text: `불러왔습니다. ${counts}` })
    } catch (err) {
      setMessage({
        kind: 'error',
        text:
          err instanceof BackupError
            ? err.message
            : `불러오지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <section className="card">
      <h2>백업</h2>
      <p className="hint">
        지금은 이 JSON 파일이 유일한 백업 수단입니다. 가끔 실제로 내보내 두세요.
      </p>
      <div className="btn-row">
        <button type="button" onClick={exportJson}>
          JSON 내보내기
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          JSON 불러오기
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void importJson(file)
          }}
        />
      </div>
      {message && (
        <p className={message.kind === 'error' ? 'msg msg--error' : 'msg msg--ok'}>
          {message.text}
        </p>
      )}
    </section>
  )
}

function DefinitionsSection() {
  const app = useApp()
  const habits = useHabits()
  const defs = useMemo(() => managedDefinitions(app.snapshot), [app.snapshot])
  const existingNames = useMemo(
    () => app.snapshot.definitions.filter((d) => !d.deleted).map((d) => d.name),
    [app.snapshot.definitions],
  )

  const addPreset = async (preset: DefinitionPreset) => {
    await habits.addDefinition(presetDefinitionInput(preset))
  }

  return (
    <section className="card">
      <h2>습관 정의</h2>
      <PresetPicker existingNames={existingNames} onAdd={addPreset} />
      <DefinitionComposer />
      {defs.length === 0 ? (
        <p className="empty">아직 정의가 없습니다.</p>
      ) : (
        <ul className="def-list">
          {defs.map((def) => (
            <DefinitionRow key={def.id} def={def} />
          ))}
        </ul>
      )}
    </section>
  )
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]

function DefinitionComposer() {
  const habits = useHabits()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<DefinitionKind>('check')
  const [unit, setUnit] = useState('')
  const [target, setTarget] = useState('')
  const [days, setDays] = useState<number[]>([])

  const reset = () => {
    setName('')
    setKind('check')
    setUnit('')
    setTarget('')
    setDays([])
    setOpen(false)
  }

  const submit = () => {
    if (!name.trim()) return
    const input: NewDefinition = {
      name,
      kind,
      unit: kind === 'quantity' ? unit : undefined,
      target: kind === 'quantity' && target ? Number(target) : undefined,
      targetDays: days.length > 0 && days.length < 7 ? [...days].sort() : undefined,
    }
    void habits.addDefinition(input)
    reset()
  }

  if (!open) {
    return (
      <button type="button" className="link-btn" onClick={() => setOpen(true)}>
        + 새 습관
      </button>
    )
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <input
        type="text"
        value={name}
        placeholder="이름 (예: 아침 약, 물)"
        onChange={(e) => setName(e.target.value)}
        aria-label="습관 이름"
        autoFocus
      />
      <div className="composer__row">
        <label>
          <input
            type="radio"
            name="kind"
            checked={kind === 'check'}
            onChange={() => setKind('check')}
          />
          체크
        </label>
        <label>
          <input
            type="radio"
            name="kind"
            checked={kind === 'quantity'}
            onChange={() => setKind('quantity')}
          />
          수량
        </label>
      </div>
      {kind === 'quantity' && (
        <div className="composer__row">
          <input
            type="text"
            value={unit}
            placeholder="단위 (ml, 정, 회)"
            onChange={(e) => setUnit(e.target.value)}
            aria-label="단위"
          />
          <input
            type="number"
            value={target}
            placeholder="하루 목표"
            onChange={(e) => setTarget(e.target.value)}
            aria-label="하루 목표"
          />
        </div>
      )}
      <fieldset className="weekdays">
        <legend>목표 요일 (비우면 매일)</legend>
        {WEEKDAYS.map((d) => (
          <label key={d} className={days.includes(d) ? 'wd wd--on' : 'wd'}>
            <input
              type="checkbox"
              checked={days.includes(d)}
              onChange={(e) =>
                setDays((prev) =>
                  e.target.checked ? [...prev, d] : prev.filter((x) => x !== d),
                )
              }
            />
            {weekdayLabel(d)}
          </label>
        ))}
      </fieldset>
      <div className="btn-row">
        <button type="submit" disabled={!name.trim()}>
          만들기
        </button>
        <button type="button" onClick={reset}>
          취소
        </button>
      </div>
    </form>
  )
}

function DefinitionRow({ def }: { def: Definition }) {
  const app = useApp()
  const habits = useHabits()
  const [editingTarget, setEditingTarget] = useState(false)
  const [next, setNext] = useState('')
  const boundaryHour = app.snapshot.settings.dayBoundaryHour
  const current = effectiveTarget(def, app.today, boundaryHour)

  const saveTarget = () => {
    const parsed = Number(next)
    if (Number.isFinite(parsed) && parsed > 0) void habits.setTarget(def, parsed)
    setNext('')
    setEditingTarget(false)
  }

  return (
    <li className={def.archived ? 'def def--archived' : 'def'}>
      <div className="def__head">
        <span className="def__name">{def.name}</span>
        <span className="badge">{def.kind === 'check' ? '체크' : '수량'}</span>
        {def.archived && <span className="badge">오늘에서 내림</span>}
      </div>
      <div className="def__meta">
        {def.kind === 'quantity' && (
          <span>
            목표 {current ?? '—'} {def.unit ?? ''}
          </span>
        )}
        <span>
          {def.targetDays
            ? `${def.targetDays.map(weekdayLabel).join('·')}요일`
            : '매일'}
        </span>
      </div>

      {def.kind === 'quantity' &&
        (editingTarget ? (
          <div className="btn-row">
            <input
              type="number"
              value={next}
              placeholder={String(current ?? '')}
              onChange={(e) => setNext(e.target.value)}
              aria-label="새 목표"
              autoFocus
            />
            <button type="button" onClick={saveTarget}>
              저장
            </button>
            <button type="button" onClick={() => setEditingTarget(false)}>
              취소
            </button>
          </div>
        ) : (
          <p className="hint">
            목표를 바꿔도 과거 달성은 그대로입니다. 그날 판정은 그 시점 목표로 합니다.
            {def.targetHistory.length > 1 && ` (이력 ${def.targetHistory.length}건)`}
          </p>
        ))}

      <div className="btn-row">
        {def.kind === 'quantity' && !editingTarget && (
          <button type="button" onClick={() => setEditingTarget(true)}>
            목표 변경
          </button>
        )}
        <button
          type="button"
          title={
            def.archived
              ? '오늘 화면에 다시 띄웁니다.'
              : '오늘 화면에서 내립니다. 과거 기록은 그대로 둡니다.'
          }
          onClick={() => void habits.editDefinition(def, { archived: !def.archived })}
        >
          {def.archived ? '오늘에 다시 띄우기' : '오늘에서 내리기'}
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => {
            if (window.confirm(`"${def.name}"과 그 기록을 전부 지웁니다. 계속할까요?`)) {
              void habits.removeDefinition(def)
            }
          }}
        >
          삭제
        </button>
      </div>
    </li>
  )
}

function DayBoundarySection() {
  const app = useApp()
  const hour = app.snapshot.settings.dayBoundaryHour
  const [draft, setDraft] = useState(String(hour))

  useEffect(() => {
    setDraft(String(hour))
  }, [hour])

  const onChange = (raw: string) => {
    setDraft(raw)
    if (raw.trim() === '') return
    const next = Number(raw)
    if (Number.isInteger(next) && next >= 0 && next <= 12) {
      void app.saveSettings({ dayBoundaryHour: next })
    }
  }

  return (
    <section className="card">
      <h2>하루 경계</h2>
      <p className="hint">
        이 시각부터 새 하루로 봅니다. 자정 기준이면 새벽에 체크한 것이 다음 날로 밀려
        늦게 자는 날마다 스트릭이 끊깁니다. 계산 규칙일 뿐이라 바꿔도 기존 기록은
        그대로 다시 해석됩니다.
      </p>
      <label className="field">
        <span>오전</span>
        <input
          type="number"
          min={0}
          max={12}
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setDraft(String(hour))}
          aria-label="하루 경계 시각"
        />
        <span>시</span>
      </label>
    </section>
  )
}

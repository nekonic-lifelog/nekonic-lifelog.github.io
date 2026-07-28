import { useState } from 'react'
import { weekdayLabel } from '../lib/day'
import { newId } from '../lib/ids'
import { DEFAULT_TZ, type RecurringReminder } from '../lib/reminders'
import { useApp } from '../state/app'

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]

const OFFSET_CHOICES: { minutes: number; label: string }[] = [
  { minutes: 2880, label: '48시간 전' },
  { minutes: 1440, label: '24시간 전' },
  { minutes: 120, label: '2시간 전' },
  { minutes: 60, label: '1시간 전' },
]

function daysLabel(days: number[] | undefined): string {
  if (!days || days.length === 0 || days.length === 7) return '매일'
  return `${days.map(weekdayLabel).join('·')}요일`
}

export function ReminderSettings() {
  const app = useApp()
  const settings = app.snapshot.settings
  const recurring = settings.recurring ?? []
  const offsets = settings.defaultOffsets ?? []
  const masked = settings.maskProjectLabels !== false

  const toggleOffset = (minutes: number) => {
    const next = offsets.includes(minutes)
      ? offsets.filter((m) => m !== minutes)
      : [...offsets, minutes].sort((a, b) => b - a)
    void app.saveSettings({ defaultOffsets: next })
  }

  const addRecurring = (made: RecurringReminder) => {
    void app.saveSettings({ recurring: [...recurring, made] })
  }

  const removeRecurring = (id: string) => {
    void app.saveSettings({ recurring: recurring.filter((r) => r.id !== id) })
  }

  return (
    <section className="card">
      <div className="card__head">
        <h2>알림</h2>
        <span className="badge">{settings.tz || DEFAULT_TZ}</span>
      </div>

      <p className="hint">
        알림 목록은 <strong>암호화하지 않고 평문으로</strong> 저장소에 올라갑니다. 회의
        제목처럼 남이 보면 곤란한 말은 라벨에 적지 마세요.
      </p>

      {recurring.length === 0 ? (
        <p className="empty">반복 알림이 없습니다.</p>
      ) : (
        recurring.map((item) => (
          <div key={item.id} className="field">
            <span className="badge">{item.at}</span>
            <span>{item.label}</span>
            <span className="hint">{daysLabel(item.days)}</span>
            <button
              type="button"
              className="icon-btn icon-btn--danger"
              onClick={() => removeRecurring(item.id)}
              aria-label={`${item.label} 알림 삭제`}
            >
              ×
            </button>
          </div>
        ))
      )}

      <RecurringComposer onAdd={addRecurring} />

      <fieldset className="weekdays">
        <legend>기본 사전 알림</legend>
        {OFFSET_CHOICES.map((choice) => (
          <button
            key={choice.minutes}
            type="button"
            className={offsets.includes(choice.minutes) ? 'wd wd--on' : 'wd'}
            aria-pressed={offsets.includes(choice.minutes)}
            onClick={() => toggleOffset(choice.minutes)}
          >
            {choice.label}
          </button>
        ))}
      </fieldset>
      <p className="hint">마감이 있는 할 일에 이 시각들로 미리 알립니다.</p>

      <div className="btn-row">
        <button
          type="button"
          aria-pressed={masked}
          onClick={() => void app.saveSettings({ maskProjectLabels: !masked })}
        >
          {masked ? '프로젝트 작업 제목 가림' : '프로젝트 작업 제목 그대로'}
        </button>
      </div>
      <p className="hint">
        가리면 프로젝트에 속한 작업은 제목 대신 &quot;업무&quot;로만 나갑니다. 개인 할 일은
        제목 그대로 나갑니다.
      </p>
    </section>
  )
}

function RecurringComposer({ onAdd }: { onAdd(made: RecurringReminder): void }) {
  const app = useApp()
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState('')
  const [label, setLabel] = useState('')
  const [days, setDays] = useState<number[]>([])

  const reset = () => {
    setAt('')
    setLabel('')
    setDays([])
    setOpen(false)
  }

  const submit = () => {
    if (!at || !label.trim()) return
    const made: RecurringReminder = {
      id: newId(),
      at,
      label: label.trim(),
      channel: app.snapshot.settings.notifyChannel ?? 'discord',
    }
    onAdd(days.length > 0 && days.length < 7 ? { ...made, days: [...days].sort() } : made)
    reset()
  }

  if (!open) {
    return (
      <button type="button" className="link-btn" onClick={() => setOpen(true)}>
        + 반복 알림
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
      <label className="field">
        <span>시각</span>
        <input
          type="time"
          value={at}
          onChange={(e) => setAt(e.target.value)}
          aria-label="반복 알림 시각"
        />
      </label>
      <input
        type="text"
        value={label}
        placeholder="라벨 (예: 저녁 약)"
        onChange={(e) => setLabel(e.target.value)}
        aria-label="반복 알림 라벨"
      />
      <fieldset className="weekdays">
        <legend>요일 (비우면 매일)</legend>
        {WEEKDAYS.map((d) => (
          <button
            key={d}
            type="button"
            className={days.includes(d) ? 'wd wd--on' : 'wd'}
            aria-pressed={days.includes(d)}
            onClick={() =>
              setDays((prev) =>
                prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
              )
            }
          >
            {weekdayLabel(d)}
          </button>
        ))}
      </fieldset>
      <div className="btn-row">
        <button type="submit" disabled={!at || !label.trim()}>
          반복 알림 추가
        </button>
        <button type="button" onClick={reset}>
          닫기
        </button>
      </div>
    </form>
  )
}

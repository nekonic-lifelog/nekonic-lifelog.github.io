import { useMemo, useState } from 'react'
import { dayKeyToDate, type DayKey } from '../lib/day'
import { shiftWeek, weekDays, weekStart, type WeekDay } from '../lib/week'
import { useApp } from '../state/app'
import '../styles/week.css'

export interface WeekStripProps {
  selected: DayKey
  today: DayKey
  onSelect(day: DayKey): void
}

function cellLabel(day: WeekDay): string {
  const date = dayKeyToDate(day.day)
  const parts = [`${date.getMonth() + 1}월 ${day.dayOfMonth}일 ${day.label}요일`]
  if (day.isToday) parts.push('오늘')
  parts.push(day.todoCount > 0 ? `할 일 ${day.todoCount}건` : '할 일 없음')
  if (day.doneCount > 0) parts.push(`완료 ${day.doneCount}건`)
  if (day.hasOverdue) parts.push('기한 지남')
  return parts.join(', ')
}

function cellClass(day: WeekDay): string {
  const classes = ['wk-cell']
  if (day.isToday) classes.push('wk-cell--today')
  if (day.isSelected) classes.push('wk-cell--on')
  if (day.hasOverdue) classes.push('wk-cell--overdue')
  return classes.join(' ')
}

function monthLabel(days: WeekDay[]): string {
  const first = days[0]
  const last = days[days.length - 1]
  if (!first || !last) return ''
  const from = dayKeyToDate(first.day).getMonth() + 1
  const to = dayKeyToDate(last.day).getMonth() + 1
  return from === to ? `${from}월` : `${from}월 · ${to}월`
}

export function WeekStrip({ selected, today, onSelect }: WeekStripProps) {
  const app = useApp()
  const [seen, setSeen] = useState(selected)
  const [anchor, setAnchor] = useState(selected)

  if (seen !== selected) {
    setSeen(selected)
    setAnchor(selected)
  }

  const days = useMemo(
    () => weekDays(anchor, today, selected, app.snapshot, app.boundaryHour),
    [anchor, today, selected, app.snapshot, app.boundaryHour],
  )

  const onThisWeek = weekStart(anchor) === weekStart(today)

  return (
    <section className="card wk">
      <div className="wk__head">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setAnchor(shiftWeek(anchor, -1))}
          aria-label="지난 주"
        >
          ‹
        </button>
        <span className="wk__month">{monthLabel(days)}</span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setAnchor(shiftWeek(anchor, 1))}
          aria-label="다음 주"
        >
          ›
        </button>
      </div>

      <div className="wk__days">
        {days.map((day) => (
          <button
            key={day.day}
            type="button"
            className={cellClass(day)}
            aria-pressed={day.isSelected}
            aria-label={cellLabel(day)}
            onClick={() => onSelect(day.day)}
          >
            <span className="wk-cell__label">{day.label}</span>
            <span className="wk-cell__num">{day.dayOfMonth}</span>
            <span className="wk-cell__dots" aria-hidden="true">
              {day.todoCount > 0 && <span className="wk-cell__dot" />}
            </span>
          </button>
        ))}
      </div>

      {!onThisWeek && (
        <button type="button" className="link-btn wk__back" onClick={() => setAnchor(today)}>
          이번 주로
        </button>
      )}
    </section>
  )
}

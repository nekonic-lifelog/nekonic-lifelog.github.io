import { useMemo, useState } from 'react'
import { addDays, dayKeyToDate, weekdayLabel, weekdayOf } from '../lib/day'
import { navigate } from '../lib/router'
import { ddayItems, formatRemaining, todosDueBy, visibleDefinitions } from '../lib/select'
import {
  dayStatus,
  habitView,
  progressPercent,
  type DayStatus,
  type HabitView,
} from '../lib/streak'
import type { Definition } from '../lib/types'
import { useApp } from '../state/app'

export function Today() {
  const app = useApp()
  const [viewDay, setViewDay] = useState(app.today)
  const boundaryHour = app.snapshot.settings.dayBoundaryHour

  const defs = useMemo(() => visibleDefinitions(app.snapshot), [app.snapshot])
  const views = useMemo(
    () =>
      defs.map((def) =>
        habitView(def, app.snapshot.records, { boundaryHour, clock: app.clock }),
      ),
    [defs, app.snapshot.records, boundaryHour, app.clock],
  )

  const ddays = useMemo(
    () => ddayItems(app.snapshot, app.today, boundaryHour).slice(0, 2),
    [app.snapshot, app.today, boundaryHour],
  )
  const todos = useMemo(
    () => todosDueBy(app.snapshot, viewDay, boundaryHour),
    [app.snapshot, viewDay, boundaryHour],
  )

  const isToday = viewDay === app.today

  return (
    <div className="screen">
      <header className="day-nav">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setViewDay(addDays(viewDay, -1))}
          aria-label="이전 날"
        >
          ‹
        </button>
        <div className="day-nav__label">
          <strong>{formatDayLabel(viewDay, app.today)}</strong>
          <span>{viewDay}</span>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setViewDay(addDays(viewDay, 1))}
          disabled={isToday}
          aria-label="다음 날"
        >
          ›
        </button>
      </header>

      {!isToday && (
        <button type="button" className="link-btn" onClick={() => setViewDay(app.today)}>
          오늘로 돌아가기
        </button>
      )}

      {ddays.length > 0 && (
        <section className="card">
          <div className="card__head">
            <h2>D-day</h2>
            <button type="button" className="link-btn" onClick={() => navigate('/dday')}>
              전체 보기
            </button>
          </div>
          <ul className="dday-list">
            {ddays.map(({ todo, remaining }) => (
              <li key={todo.id}>
                <span className={remaining < 0 ? 'dday-chip dday-chip--past' : 'dday-chip'}>
                  {formatRemaining(remaining)}
                </span>
                <span className="dday-title">{todo.title}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="card__head">
          <h2>습관</h2>
          <button type="button" className="link-btn" onClick={() => navigate('/settings')}>
            정의 관리
          </button>
        </div>
        {views.length === 0 ? (
          <p className="empty">
            아직 습관이 없습니다. 설정에서 추적할 것을 하나 만들어 보세요.
          </p>
        ) : (
          <ul className="habit-list">
            {views.map((view) => (
              <HabitRow key={view.definition.id} view={view} viewDay={viewDay} />
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card__head">
          <h2>{isToday ? '오늘 할 일' : '이 날까지의 할 일'}</h2>
          <button type="button" className="link-btn" onClick={() => navigate('/todos')}>
            전체 보기
          </button>
        </div>
        {todos.length === 0 ? (
          <p className="empty">기한이 걸린 할 일이 없습니다.</p>
        ) : (
          <ul className="todo-list">
            {todos.map((todo) => (
              <li key={todo.id}>
                <button
                  type="button"
                  className="check"
                  onClick={() => void app.setTodoStatus(todo, 'done')}
                  aria-label={`${todo.title} 완료`}
                />
                <span className="todo-title">{todo.title}</span>
                {todo.dueAt && (
                  <span className="todo-due">{todo.dueAt.slice(0, 10)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function HabitRow({ view, viewDay }: { view: HabitView; viewDay: string }) {
  const app = useApp()
  const def = view.definition
  const boundaryHour = app.snapshot.settings.dayBoundaryHour
  const status = useMemo(
    () => dayStatus(def, app.snapshot.records, viewDay, { boundaryHour, clock: app.clock }),
    [def, app.snapshot.records, viewDay, boundaryHour, app.clock],
  )

  return (
    <li className="habit">
      <div className="habit__main">
        {def.kind === 'check' ? (
          <button
            type="button"
            className={status.achieved ? 'check check--on' : 'check'}
            onClick={() => void app.toggleCheck(def, viewDay)}
            aria-pressed={status.achieved}
            aria-label={`${def.name} 체크`}
          />
        ) : (
          <ProgressRing status={status} />
        )}
        <div className="habit__text">
          <span className="habit__name">{def.name}</span>
          {def.kind === 'quantity' && (
            <span className="habit__amount">
              {status.total}
              {status.target !== null ? ` / ${status.target}` : ''} {def.unit ?? ''}
            </span>
          )}
        </div>
        <span className="habit__streak" title="연속 달성일">
          {view.streak > 0 ? `🔥 ${view.streak}` : '—'}
        </span>
      </div>
      <div className="habit__foot">
        <RecentDots view={view} />
      </div>
      {def.kind === 'quantity' && (
        <QuantityControl def={def} day={viewDay} status={status} />
      )}
    </li>
  )
}

function ProgressRing({ status }: { status: DayStatus }) {
  const pct = progressPercent(status)
  const fill = pct > 0 ? Math.max(pct, MIN_VISIBLE_FILL) : 0
  const label =
    pct === 0 ? '기록 없음' : pct < 1 ? '달성률 1% 미만' : `달성률 ${Math.round(pct)}%`

  return (
    <span
      className={status.achieved ? 'ring ring--on' : 'ring'}
      style={{ ['--p' as string]: fill }}
      role="img"
      aria-label={label}
    />
  )
}

const MIN_VISIBLE_FILL = 6

function RecentDots({ view }: { view: HabitView }) {
  const labelled = view.definition.targetDays !== undefined
  return (
    <div className="dots">
      {view.recent.map((d) => {
        const cls = !d.isTargetDay
          ? 'dot dot--skip'
          : d.achieved
            ? 'dot dot--on'
            : 'dot'
        return (
          <span key={d.day} className={cls} title={d.day}>
            {labelled ? weekdayLabel(weekdayOf(d.day)) : ''}
          </span>
        )
      })}
    </div>
  )
}

function QuantityControl({
  def,
  day,
  status,
}: {
  def: Definition
  day: string
  status: DayStatus
}) {
  const app = useApp()
  const [amount, setAmount] = useState('')
  const empty = status.count === 0

  const step = () => {
    const parsed = Number(amount)
    if (Number.isFinite(parsed) && parsed !== 0) {
      void app.addQuantity(def, day, parsed)
      setAmount('')
    }
  }

  return (
    <div className="qty">
      <input
        type="number"
        inputMode="decimal"
        value={amount}
        placeholder={def.unit ?? '값'}
        onChange={(e) => setAmount(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') step()
        }}
        aria-label={`${def.name} 추가할 양`}
      />
      <button type="button" className="qty__add" onClick={step} aria-label="추가">
        +
      </button>
      <button
        type="button"
        className="qty__undo"
        disabled={empty}
        onClick={() => void app.undoLast(def, day)}
        aria-label="마지막 입력 취소"
        title="마지막 입력 취소"
      >
        ↺
      </button>
    </div>
  )
}

function formatDayLabel(day: string, today: string): string {
  if (day === today) return '오늘'
  if (day === addDays(today, -1)) return '어제'
  const d = dayKeyToDate(day)
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdayLabel(d.getDay())})`
}

import { useMemo, useState } from 'react'
import { addDays, dayKeyToDate, daysBetween, weekdayLabel, weekdayOf } from '../lib/day'
import { dueDateValue, toDueAt } from '../lib/due'
import { todosForDay, type TodoGroupItem } from '../lib/groupTodos'
import { navigate } from '../lib/router'
import {
  archivedDefinitions,
  ddayItems,
  dueDayOf,
  formatRemaining,
  visibleDefinitions,
} from '../lib/select'
import { todoPlace } from '../lib/selectProjects'
import {
  aggregateOf,
  dailyTotals,
  dayStatus,
  habitView,
  isScored,
  progressPercent,
  tallyValue,
  type DayStatus,
  type HabitView,
} from '../lib/streak'
import type { Definition, Todo } from '../lib/types'
import { ScaleChips } from '../ui/ScaleChips'
import { WeekStrip } from '../ui/WeekStrip'
import { useApp } from '../state/app'
import { useHabits } from '../state/habits'
import { useTodos } from '../state/todos'
import '../styles/measures.css'
import '../styles/projects.css'
import '../styles/today.css'

export function Today() {
  const app = useApp()
  const [viewDay, setViewDay] = useState(app.today)
  const boundaryHour = app.snapshot.settings.dayBoundaryHour

  const defs = useMemo(() => visibleDefinitions(app.snapshot), [app.snapshot])
  const archived = useMemo(() => archivedDefinitions(app.snapshot), [app.snapshot])
  const scoredDefs = useMemo(() => defs.filter((d) => isScored(d)), [defs])
  const measureDefs = useMemo(() => defs.filter((d) => !isScored(d)), [defs])
  const views = useMemo(
    () =>
      scoredDefs.map((def) =>
        habitView(def, app.snapshot.records, { boundaryHour, clock: app.clock }),
      ),
    [scoredDefs, app.snapshot.records, boundaryHour, app.clock],
  )

  const ddays = useMemo(
    () => ddayItems(app.snapshot, app.today, boundaryHour).slice(0, 2),
    [app.snapshot, app.today, boundaryHour],
  )
  const todos = useMemo(
    () => todosForDay(app.snapshot, viewDay, boundaryHour),
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

      <WeekStrip selected={viewDay} today={app.today} onSelect={setViewDay} />

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
          archived.length > 0 ? (
            <p className="empty">
              오늘에서 내려둔 습관 {archived.length}개가 있습니다 (
              {archived.map((d) => d.name).join(' · ')}). 설정 → 습관 정의에서 다시
              띄울 수 있습니다.
            </p>
          ) : (
            <p className="empty">
              아직 습관이 없습니다. 설정에서 추적할 것을 하나 만들어 보세요.
            </p>
          )
        ) : (
          <ul className="habit-list">
            {views.map((view) => (
              <HabitRow key={view.definition.id} view={view} viewDay={viewDay} />
            ))}
          </ul>
        )}
      </section>

      {measureDefs.length > 0 && (
        <section className="card">
          <div className="card__head">
            <h2>기록</h2>
          </div>
          <ul className="measure-list">
            {measureDefs.map((def) => (
              <MeasureRow key={def.id} def={def} viewDay={viewDay} />
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="card__head">
          <h2>{isToday ? '오늘 할 일' : '이 날까지의 할 일'}</h2>
          <button type="button" className="link-btn" onClick={() => navigate('/todos')}>
            전체 보기
          </button>
        </div>
        <QuickTodo viewDay={viewDay} />

        {todos.overdue.length > 0 && (
          <OverdueTodos
            items={todos.overdue}
            viewDay={viewDay}
            boundaryHour={boundaryHour}
          />
        )}

        {todos.due.length === 0 ? (
          <p className="empty">할 일이 없습니다.</p>
        ) : (
          <>
            {todos.overdue.length > 0 && (
              <p className="today-group__title">{formatDayLabel(viewDay, app.today)}</p>
            )}
            <ul className="todo-list">
              {todos.due.map((item) => (
                <TodayTodoRow key={item.todo.id} item={item} late={null} />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}

function QuickTodo({ viewDay }: { viewDay: string }) {
  const todoApi = useTodos()
  const [title, setTitle] = useState('')
  const ready = title.trim() !== ''

  const submit = () => {
    if (!ready) return
    void todoApi.addTodo({ title, dueAt: toDueAt(viewDay) })
    setTitle('')
  }

  return (
    <form
      className="today-add"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <input
        type="text"
        value={title}
        placeholder="할 일 한 줄 적기"
        onChange={(e) => setTitle(e.target.value)}
        aria-label="할 일 제목"
      />
      <button type="submit" disabled={!ready} aria-label="할 일 추가">
        추가
      </button>
    </form>
  )
}

function OverdueTodos({
  items,
  viewDay,
  boundaryHour,
}: {
  items: TodoGroupItem[]
  viewDay: string
  boundaryHour: number
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="today-overdue">
      <button
        type="button"
        className="link-btn today-overdue__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        지난 기한 {items.length}건 {open ? '접기' : '펼치기'}
      </button>
      {open && (
        <ul className="todo-list">
          {items.map((item) => (
            <TodayTodoRow
              key={item.todo.id}
              item={item}
              late={lateDays(item.todo, viewDay, boundaryHour)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function lateDays(todo: Todo, viewDay: string, boundaryHour: number): number | null {
  const due = dueDayOf(todo, boundaryHour)
  return due === null ? null : daysBetween(due, viewDay)
}

function TodayTodoRow({ item, late }: { item: TodoGroupItem; late: number | null }) {
  const todoApi = useTodos()
  const { todo, project } = item
  const place = todoPlace(todo)
  const meta = project !== undefined || place !== '' || late !== null

  return (
    <li className={late === null ? 'today-todo' : 'today-todo todo--overdue'}>
      <button
        type="button"
        className="check"
        onClick={() => void todoApi.setTodoStatus(todo, 'done')}
        aria-label={`${todo.title} 완료`}
      />
      <span className="todo-title">{todo.title}</span>
      {meta && (
        <span className="today-todo__meta">
          {project && <span className="badge project-chip">{project.name}</span>}
          {place !== '' && (
            <span className="todo-place" title={place}>
              {place}
            </span>
          )}
          {late !== null && todo.dueAt && (
            <span
              className="dday-chip dday-chip--past"
              title={`기한 ${dueDateValue(todo.dueAt)}`}
              aria-label={`기한 ${dueDateValue(todo.dueAt)}, ${-late}일 지남`}
            >
              {formatRemaining(late)}
            </span>
          )}
        </span>
      )}
    </li>
  )
}

function HabitRow({ view, viewDay }: { view: HabitView; viewDay: string }) {
  const app = useApp()
  const habits = useHabits()
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
            onClick={() => void habits.toggleCheck(def, viewDay)}
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
        <span
          className="habit__streak"
          role="img"
          aria-label={streakLabel(def.name, view.streak)}
          title="연속 달성일"
        >
          {view.streak > 0 ? `🔥 ${view.streak}` : '—'}
        </span>
      </div>
      <div className="habit__foot">
        <RecentDots view={view} />
      </div>
      {def.kind === 'quantity' && (
        <QuantityControl def={def} day={viewDay} count={status.count} />
      )}
    </li>
  )
}

function MeasureRow({ def, viewDay }: { def: Definition; viewDay: string }) {
  const app = useApp()
  const habits = useHabits()
  const boundaryHour = app.snapshot.settings.dayBoundaryHour
  const tally = useMemo(
    () => dailyTotals(def, app.snapshot.records, boundaryHour).get(viewDay),
    [def, app.snapshot.records, boundaryHour, viewDay],
  )

  const count = tally?.count ?? 0
  const empty = count === 0 || tally === undefined
  const value = tally ? tallyValue(def, tally) : 0
  const keepsLast = aggregateOf(def) === 'last'
  const suffix = def.unit ? ` ${def.unit}` : ''
  const at = empty ? '아직 기록 없음' : formatClock(tally.lastAt)
  const label = empty
    ? `${def.name} 아직 기록이 없습니다`
    : `${def.name} ${keepsLast ? '마지막 값' : '합계'} ${value}${suffix}, 마지막 기록 ${at}`

  return (
    <li className="measure">
      <div className="measure__main">
        <span className="measure__name">{def.name}</span>
        <span className="measure__read" role="img" aria-label={label}>
          <span className="measure__value">{empty ? '—' : `${value}${suffix}`}</span>
          <span className="measure__at">{at}</span>
        </span>
      </div>
      {def.scale ? (
        <div className="measure__scale">
          <ScaleChips
            name={def.name}
            min={def.scale.min}
            max={def.scale.max}
            unit={def.unit}
            selected={keepsLast && !empty ? value : null}
            onPick={(picked) => void habits.addQuantity(def, viewDay, picked)}
          />
          <UndoButton
            def={def}
            day={viewDay}
            empty={empty}
            label={`${def.name} 마지막 기록 취소`}
          />
        </div>
      ) : (
        <QuantityControl
          def={def}
          day={viewDay}
          count={count}
          addLabel={`${def.name} 추가`}
          undoLabel={`${def.name} 마지막 기록 취소`}
        />
      )}
    </li>
  )
}

function formatClock(at: string | undefined): string {
  if (at === undefined) return '아직 기록 없음'
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return '시각 알 수 없음'
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function UndoButton({
  def,
  day,
  empty,
  label = '마지막 입력 취소',
}: {
  def: Definition
  day: string
  empty: boolean
  label?: string
}) {
  const habits = useHabits()
  return (
    <button
      type="button"
      className="qty__undo"
      disabled={empty}
      onClick={() => void habits.undoLast(def, day)}
      aria-label={label}
      title={label}
    >
      ↺
    </button>
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

function streakLabel(name: string, streak: number): string {
  return streak > 0 ? `${name} 연속 ${streak}일 달성` : `${name} 연속 달성 없음`
}

function recentLabel(view: HabitView): string {
  const span = view.recent.length
  const targets = view.recent.filter((d) => d.isTargetDay)
  const done = targets.filter((d) => d.achieved).length
  if (targets.length === span) return `최근 ${span}일 중 ${done}일 달성`
  return `최근 ${span}일 중 목표 요일은 ${targets.length}일, 그중 ${done}일 달성`
}

function RecentDots({ view }: { view: HabitView }) {
  const labelled = view.definition.targetDays !== undefined
  return (
    <div className="dots" role="img" aria-label={recentLabel(view)}>
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
  count,
  addLabel = '추가',
  undoLabel = '마지막 입력 취소',
}: {
  def: Definition
  day: string
  count: number
  addLabel?: string
  undoLabel?: string
}) {
  const habits = useHabits()
  const [amount, setAmount] = useState('')
  const empty = count === 0

  const step = () => {
    const parsed = Number(amount)
    if (Number.isFinite(parsed) && parsed !== 0) {
      void habits.addQuantity(def, day, parsed)
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
      <button type="button" className="qty__add" onClick={step} aria-label={addLabel}>
        +
      </button>
      <UndoButton def={def} day={day} empty={empty} label={undoLabel} />
    </div>
  )
}

function formatDayLabel(day: string, today: string): string {
  if (day === today) return '오늘'
  if (day === addDays(today, -1)) return '어제'
  const d = dayKeyToDate(day)
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdayLabel(d.getDay())})`
}

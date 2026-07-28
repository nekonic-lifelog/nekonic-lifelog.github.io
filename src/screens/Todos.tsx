import { useMemo, useState } from 'react'
import { daysBetween } from '../lib/day'
import { activeTodos, dueDayOf, formatRemaining } from '../lib/select'
import type { Todo } from '../lib/types'
import { useApp } from '../state/app'

export function Todos() {
  const app = useApp()
  const [showDone, setShowDone] = useState(false)
  const boundaryHour = app.snapshot.settings.dayBoundaryHour

  const { open, done } = useMemo(() => {
    const all = activeTodos(app.snapshot).filter((t) => !t.projectId)
    return {
      open: all
        .filter((t) => t.status !== 'done')
        .sort(byDue),
      done: all
        .filter((t) => t.status === 'done')
        .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')),
    }
  }, [app.snapshot])

  return (
    <div className="screen">
      <h1 className="screen__title">할 일</h1>
      <TodoComposer />

      {open.length === 0 ? (
        <p className="empty">할 일이 없습니다.</p>
      ) : (
        <ul className="todo-list todo-list--full">
          {open.map((todo) => (
            <TodoRow key={todo.id} todo={todo} boundaryHour={boundaryHour} today={app.today} />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <section className="card">
          <button
            type="button"
            className="link-btn"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
          >
            완료 {done.length}건 {showDone ? '접기' : '펼치기'}
          </button>
          {showDone && (
            <ul className="todo-list todo-list--full">
              {done.map((todo) => (
                <TodoRow
                  key={todo.id}
                  todo={todo}
                  boundaryHour={boundaryHour}
                  today={app.today}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function byDue(a: Todo, b: Todo): number {
  if (!a.dueAt && !b.dueAt) return a.createdAt.localeCompare(b.createdAt)
  if (!a.dueAt) return 1
  if (!b.dueAt) return -1
  return a.dueAt.localeCompare(b.dueAt)
}

function TodoComposer() {
  const app = useApp()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [pinned, setPinned] = useState(false)

  const submit = () => {
    if (!title.trim()) return
    void app.addTodo({
      title,
      dueAt: due ? new Date(`${due}T12:00:00`).toISOString() : undefined,
      pinned,
    })
    setTitle('')
    setDue('')
    setPinned(false)
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
        value={title}
        placeholder="할 일 추가"
        onChange={(e) => setTitle(e.target.value)}
        aria-label="할 일 제목"
      />
      <div className="composer__row">
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="기한"
        />
        <label className="composer__pin">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
          />
          D-day로 고정
        </label>
        <button type="submit" disabled={!title.trim()}>
          추가
        </button>
      </div>
      {pinned && !due && (
        <p className="hint">D-day로 고정하려면 기한이 있어야 합니다.</p>
      )}
    </form>
  )
}

function TodoRow({
  todo,
  boundaryHour,
  today,
}: {
  todo: Todo
  boundaryHour: number
  today: string
}) {
  const app = useApp()
  const due = dueDayOf(todo, boundaryHour)
  const remaining = due ? daysBetween(due, today) : null
  const overdue = remaining !== null && remaining < 0 && todo.status !== 'done'

  return (
    <li className={overdue ? 'todo todo--overdue' : 'todo'}>
      <button
        type="button"
        className={todo.status === 'done' ? 'check check--on' : 'check'}
        onClick={() => void app.setTodoStatus(todo, todo.status === 'done' ? 'todo' : 'done')}
        aria-pressed={todo.status === 'done'}
        aria-label={`${todo.title} 완료 토글`}
      />
      <div className="todo__text">
        <span className={todo.status === 'done' ? 'todo-title todo-title--done' : 'todo-title'}>
          {todo.title}
        </span>
        {due && (
          <span className="todo-meta">
            {due}
            {remaining !== null && todo.status !== 'done' && (
              <span className={overdue ? 'dday-chip dday-chip--past' : 'dday-chip'}>
                {formatRemaining(remaining)}
              </span>
            )}
          </span>
        )}
      </div>
      <button
        type="button"
        className={todo.pinned ? 'pin pin--on' : 'pin'}
        onClick={() => void app.editTodo(todo, { pinned: !todo.pinned })}
        aria-pressed={todo.pinned}
        aria-label="D-day 고정"
        disabled={!todo.dueAt}
        title={todo.dueAt ? 'D-day로 고정' : '기한이 있어야 고정할 수 있습니다'}
      >
        ★
      </button>
      <button
        type="button"
        className="icon-btn icon-btn--danger"
        onClick={() => void app.removeTodo(todo)}
        aria-label={`${todo.title} 삭제`}
      >
        ×
      </button>
    </li>
  )
}

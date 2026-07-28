import { useMemo, useState } from 'react'
import { daysBetween, logicalDay } from '../lib/day'
import { formatDueLabel, toDueAt } from '../lib/due'
import { dueDayOf, formatRemaining } from '../lib/select'
import { personalTodos, projectProgress, sortedProjects } from '../lib/selectProjects'
import type { Project, Todo } from '../lib/types'
import { useApp } from '../state/app'
import { useTodos } from '../state/todos'
import { AlertChips, DueEditor, ProjectComposer, ProjectDetail } from './Projects'
import '../styles/projects.css'

export function Todos() {
  const app = useApp()
  const [showDone, setShowDone] = useState(false)
  const [composing, setComposing] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const boundaryHour = app.snapshot.settings.dayBoundaryHour

  const { open, done } = useMemo(() => {
    const all = personalTodos(app.snapshot)
    return {
      open: all
        .filter((t) => t.status !== 'done')
        .sort(byDue),
      done: all
        .filter((t) => t.status === 'done')
        .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')),
    }
  }, [app.snapshot])

  const projects = useMemo(() => sortedProjects(app.snapshot), [app.snapshot])
  const opened = openId === null ? undefined : projects.find((p) => p.id === openId)

  if (opened) {
    return <ProjectDetail project={opened} onBack={() => setOpenId(null)} />
  }

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

      <section className="card project-section">
        <div className="card__head">
          <h2>프로젝트</h2>
          <button
            type="button"
            className="link-btn"
            onClick={() => setComposing((v) => !v)}
            aria-expanded={composing}
          >
            {composing ? '닫기' : '+ 새 프로젝트'}
          </button>
        </div>

        {composing && (
          <ProjectComposer
            onCreated={() => {
              setComposing(false)
            }}
          />
        )}

        {projects.length === 0 ? (
          <p className="empty">프로젝트가 없습니다.</p>
        ) : (
          <ul className="project-list">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                boundaryHour={boundaryHour}
                today={app.today}
                onOpen={() => setOpenId(project.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function byDue(a: Todo, b: Todo): number {
  if (!a.dueAt && !b.dueAt) return a.createdAt.localeCompare(b.createdAt)
  if (!a.dueAt) return 1
  if (!b.dueAt) return -1
  return a.dueAt.localeCompare(b.dueAt)
}

function ProjectCard({
  project,
  boundaryHour,
  today,
  onOpen,
}: {
  project: Project
  boundaryHour: number
  today: string
  onOpen(): void
}) {
  const app = useApp()
  const progress = projectProgress(app.snapshot, project)
  const due = project.dueAt ? logicalDay(project.dueAt, boundaryHour) : null
  const remaining = due ? daysBetween(due, today) : null
  const overdue = remaining !== null && remaining < 0 && project.status !== 'done'

  const classes = ['project-card']
  if (project.status === 'held') classes.push('project-card--held')
  if (project.status === 'done') classes.push('project-card--done')
  if (overdue) classes.push('project-card--overdue')

  return (
    <li>
      <button type="button" className={classes.join(' ')} onClick={onOpen}>
        <span className="project-card__head">
          <span className="project-name">{project.name}</span>
          <span className="project-count">
            {progress.done}/{progress.total}
          </span>
        </span>
        <span className="project-bar">
          <span className="project-bar__fill" style={{ width: `${progress.percent}%` }} />
        </span>
        {due && project.dueAt && (
          <span className="todo-due">
            {formatDueLabel(project.dueAt)}
            {remaining !== null && project.status !== 'done' && (
              <span className={overdue ? 'dday-chip dday-chip--past' : 'dday-chip'}>
                {formatRemaining(remaining)}
              </span>
            )}
            <AlertChips dueAt={project.dueAt} />
          </span>
        )}
      </button>
    </li>
  )
}

function TodoComposer() {
  const todoApi = useTodos()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [pinned, setPinned] = useState(false)

  const submit = () => {
    if (!title.trim()) return
    void todoApi.addTodo({
      title,
      dueAt: toDueAt(due, dueTime),
      pinned,
    })
    setTitle('')
    setDue('')
    setDueTime('')
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
        <input
          type="time"
          value={dueTime}
          onChange={(e) => setDueTime(e.target.value)}
          aria-label="기한 시각"
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
  const todoApi = useTodos()
  const due = dueDayOf(todo, boundaryHour)
  const remaining = due ? daysBetween(due, today) : null
  const overdue = remaining !== null && remaining < 0 && todo.status !== 'done'

  return (
    <li className={overdue ? 'todo todo--overdue' : 'todo'}>
      <button
        type="button"
        className={todo.status === 'done' ? 'check check--on' : 'check'}
        onClick={() => void todoApi.setTodoStatus(todo, todo.status === 'done' ? 'todo' : 'done')}
        aria-pressed={todo.status === 'done'}
        aria-label={`${todo.title} 완료 토글`}
      />
      <div className="todo__text">
        <span className={todo.status === 'done' ? 'todo-title todo-title--done' : 'todo-title'}>
          {todo.title}
        </span>
        <DueEditor todo={todo} remaining={remaining} overdue={overdue} />
      </div>
      <button
        type="button"
        className={todo.pinned ? 'pin pin--on' : 'pin'}
        onClick={() => void todoApi.editTodo(todo, { pinned: !todo.pinned })}
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
        onClick={() => void todoApi.removeTodo(todo)}
        aria-label={`${todo.title} 삭제`}
      >
        ×
      </button>
    </li>
  )
}

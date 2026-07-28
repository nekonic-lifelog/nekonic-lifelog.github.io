import { useMemo, useState } from 'react'
import { daysBetween, logicalDay } from '../lib/day'
import { formatDueLabel, toDueAt } from '../lib/due'
import { groupTodosByDue } from '../lib/groupTodos'
import { dueDayOf, formatRemaining } from '../lib/select'
import {
  checklistProgress,
  noteSummary,
  personalTodos,
  projectProgress,
  sortedProjects,
} from '../lib/selectProjects'
import type { Project, Todo } from '../lib/types'
import { useApp } from '../state/app'
import { useTodos } from '../state/todos'
import { Timeline } from '../ui/Timeline'
import {
  AlertChips,
  DueEditor,
  PlaceNoteButton,
  PlaceNoteLine,
  ProjectComposer,
  ProjectDetail,
} from './Projects'
import '../styles/projects.css'

export function Todos() {
  const app = useApp()
  const [showDone, setShowDone] = useState(false)
  const [composing, setComposing] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const boundaryHour = app.snapshot.settings.dayBoundaryHour

  const groups = useMemo(
    () => groupTodosByDue(app.snapshot, app.today, boundaryHour),
    [app.snapshot, app.today, boundaryHour],
  )

  const done = useMemo(
    () =>
      personalTodos(app.snapshot)
        .filter((t) => t.status === 'done')
        .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')),
    [app.snapshot],
  )

  const projects = useMemo(() => sortedProjects(app.snapshot), [app.snapshot])
  const opened = openId === null ? undefined : projects.find((p) => p.id === openId)

  if (opened) {
    return <ProjectDetail project={opened} onBack={() => setOpenId(null)} />
  }

  return (
    <div className="screen">
      <h1 className="screen__title">할 일</h1>
      <TodoComposer />

      {groups.length === 0 ? (
        <p className="empty">할 일이 없습니다.</p>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="card todo-group">
            <div className="card__head">
              <h2>{group.title}</h2>
              <span className="project-count">{group.items.length}</span>
            </div>
            <ul className="todo-list">
              {group.items.map((item) => (
                <TodoRow
                  key={item.todo.id}
                  todo={item.todo}
                  project={item.project}
                  boundaryHour={boundaryHour}
                  today={app.today}
                />
              ))}
            </ul>
          </section>
        ))
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

      <Timeline onOpen={(project) => setOpenId(project.id)} />

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
  const checks = checklistProgress(project)
  const summary = noteSummary(project)
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
          <span className="project-card__counts">
            {checks.total > 0 && (
              <span
                className="project-count project-check-count"
                title={`체크리스트 ${checks.done}/${checks.total}`}
              >
                ☑ {checks.done}/{checks.total}
              </span>
            )}
            <span className="project-count" title={`작업 ${progress.done}/${progress.total}`}>
              작업 {progress.done}/{progress.total}
            </span>
          </span>
        </span>
        <span className="project-bar">
          <span className="project-bar__fill" style={{ width: `${progress.percent}%` }} />
        </span>
        {summary !== '' && <span className="project-card__note">{summary}</span>}
        {due && project.dueAt && (
          <span className="todo-due">
            {formatDueLabel(project.dueAt)}
            {remaining !== null && project.status !== 'done' && (
              <span className={overdue ? 'dday-chip dday-chip--past' : 'dday-chip'}>
                {formatRemaining(remaining)}
              </span>
            )}
            <AlertChips dueAt={project.dueAt} done={project.status === 'done'} />
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
  const [detail, setDetail] = useState(false)
  const [place, setPlace] = useState('')
  const [note, setNote] = useState('')

  const submit = () => {
    if (!title.trim()) return
    void todoApi.addTodo({
      title,
      dueAt: toDueAt(due, dueTime),
      pinned,
      place,
      note,
    })
    setTitle('')
    setDue('')
    setDueTime('')
    setPinned(false)
    setPlace('')
    setNote('')
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
        <button
          type="button"
          className="link-btn composer__more"
          aria-expanded={detail}
          onClick={() => setDetail((v) => !v)}
        >
          자세히
        </button>
        <button type="submit" disabled={!title.trim()}>
          추가
        </button>
      </div>
      {detail && (
        <div className="composer__row composer__detail">
          <input
            type="text"
            value={place}
            placeholder="장소"
            onChange={(e) => setPlace(e.target.value)}
            aria-label="장소"
          />
          <input
            type="text"
            value={note}
            placeholder="메모"
            onChange={(e) => setNote(e.target.value)}
            aria-label="메모"
          />
        </div>
      )}
      {pinned && !due && (
        <p className="hint">D-day로 고정하려면 기한이 있어야 합니다.</p>
      )}
    </form>
  )
}

function TodoRow({
  todo,
  project,
  boundaryHour,
  today,
}: {
  todo: Todo
  project?: Project | undefined
  boundaryHour: number
  today: string
}) {
  const todoApi = useTodos()
  const [extra, setExtra] = useState(false)
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
        <span className="todo-head">
          <span className={todo.status === 'done' ? 'todo-title todo-title--done' : 'todo-title'}>
            {todo.title}
          </span>
          <PlaceNoteButton todo={todo} open={extra} onToggle={() => setExtra((v) => !v)} />
        </span>
        {project && <span className="badge project-chip">{project.name}</span>}
        <DueEditor todo={todo} remaining={remaining} overdue={overdue} />
        <PlaceNoteLine todo={todo} open={extra} onClose={() => setExtra(false)} />
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

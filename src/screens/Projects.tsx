import { useMemo, useState } from 'react'
import { daysBetween, logicalDay } from '../lib/day'
import { dueDateValue, dueTimeValue, formatDueLabel, toDueAt } from '../lib/due'
import { formatRemaining } from '../lib/select'
import {
  checklistProgress,
  noteSummary,
  projectChecklist,
  projectMeetings,
  projectProgress,
  projectTasks,
  tasksByStatus,
} from '../lib/selectProjects'
import type {
  ChecklistItem,
  Journal,
  Project,
  ProjectStatus,
  Todo,
  TodoStatus,
} from '../lib/types'
import { useApp } from '../state/app'
import { useProjects } from '../state/projects'
import { useTodos } from '../state/todos'

const MINUTE_MS = 60_000

const TASK_STATUS_LABEL: Record<TodoStatus, string> = {
  doing: '진행 중',
  todo: '대기',
  held: '보류',
  done: '완료',
}

const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: '진행',
  held: '보류',
  done: '완료',
}

const PROJECT_STATUSES: ProjectStatus[] = ['active', 'held', 'done']

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function formatMoment(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return at
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatAlertOffset(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60}h`
  if (minutes < 60) return `${minutes}분`
  return `${Number((minutes / 60).toFixed(1))}h`
}

function usableOffsets(raw: number[] | undefined): number[] {
  if (!Array.isArray(raw)) return []
  const kept = new Set<number>()
  for (const value of raw) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const minutes = Math.trunc(value)
    if (minutes <= 0) continue
    kept.add(minutes)
  }
  return [...kept].sort((a, b) => b - a)
}

export function AlertChips({
  dueAt,
  done,
}: {
  dueAt?: string | undefined
  done?: boolean | undefined
}) {
  const app = useApp()
  const offsets = usableOffsets(app.snapshot.settings.defaultOffsets)

  if (done === true) return null
  if (!dueAt) return null
  const at = Date.parse(dueAt)
  if (Number.isNaN(at)) return null
  if (at <= app.clock.now()) return null
  if (offsets.length === 0) return null

  const times = offsets.map((minutes) => {
    const sendAt = formatDueLabel(new Date(at - minutes * MINUTE_MS).toISOString())
    return `${sendAt} (${formatAlertOffset(minutes)} 전)`
  })
  const label = `알림 예정 ${offsets.length}번: ${times.join(', ')}`

  return (
    <span className="project-alert" title={label} aria-label={label}>
      알림 {offsets.length}
    </span>
  )
}

export function DueEditor({
  todo,
  remaining,
  overdue,
}: {
  todo: Todo
  remaining: number | null
  overdue: boolean
}) {
  const todoApi = useTodos()
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')

  const start = () => {
    setDate(dueDateValue(todo.dueAt))
    setTime(dueTimeValue(todo.dueAt))
    setEditing(true)
  }

  if (editing) {
    return (
      <span className="todo-meta due-edit">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label={`${todo.title} 기한 날짜`}
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          aria-label={`${todo.title} 기한 시각`}
        />
        <button
          type="button"
          onClick={() => {
            void todoApi.editTodo(todo, { dueAt: toDueAt(date, time) })
            setEditing(false)
          }}
        >
          저장
        </button>
        <button
          type="button"
          onClick={() => {
            void todoApi.editTodo(todo, { dueAt: undefined, pinned: false })
            setEditing(false)
          }}
        >
          기한 지우기
        </button>
        <button type="button" onClick={() => setEditing(false)}>
          취소
        </button>
      </span>
    )
  }

  return (
    <span className="todo-meta">
      <button
        type="button"
        className="link-btn due-btn"
        onClick={start}
        aria-label={`${todo.title} 기한 편집`}
      >
        {todo.dueAt ? formatDueLabel(todo.dueAt) : '기한 없음'}
      </button>
      {remaining !== null && todo.status !== 'done' && (
        <span className={overdue ? 'dday-chip dday-chip--past' : 'dday-chip'}>
          {formatRemaining(remaining)}
        </span>
      )}
      <AlertChips dueAt={todo.dueAt} done={todo.status === 'done'} />
    </span>
  )
}

export function ProjectComposer({
  onCreated,
}: {
  onCreated?: ((project: Project) => void) | undefined
}) {
  const api = useProjects()
  const [name, setName] = useState('')
  const [start, setStart] = useState('')
  const [due, setDue] = useState('')
  const [dueTime, setDueTime] = useState('')

  const submit = () => {
    if (!name.trim()) return
    void (async () => {
      const project = await api.addProject({
        name,
        startAt: toDueAt(start),
        dueAt: toDueAt(due, dueTime),
      })
      onCreated?.(project)
    })()
    setName('')
    setStart('')
    setDue('')
    setDueTime('')
  }

  return (
    <form
      className="composer project-composer"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <input
        type="text"
        value={name}
        placeholder="프로젝트 이름"
        onChange={(e) => setName(e.target.value)}
        aria-label="프로젝트 이름"
      />
      <div className="composer__row">
        <input
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          aria-label="프로젝트 시작일"
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="프로젝트 마감일"
        />
        <input
          type="time"
          value={dueTime}
          onChange={(e) => setDueTime(e.target.value)}
          aria-label="프로젝트 마감 시각"
        />
        <button type="submit" disabled={!name.trim()}>
          프로젝트 만들기
        </button>
      </div>
    </form>
  )
}

export function ProjectDetail({
  project,
  onBack,
  onOpenMeeting,
}: {
  project: Project
  onBack(): void
  onOpenMeeting?: ((meeting: Journal) => void) | undefined
}) {
  const app = useApp()
  const api = useProjects()
  const [showDone, setShowDone] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const boundaryHour = app.snapshot.settings.dayBoundaryHour

  const tasks = useMemo(
    () => projectTasks(app.snapshot, project.id),
    [app.snapshot, project.id],
  )
  const groups = useMemo(() => tasksByStatus(tasks), [tasks])
  const progress = useMemo(
    () => projectProgress(app.snapshot, project),
    [app.snapshot, project],
  )
  const meetings = useMemo(
    () => projectMeetings(app.snapshot, project.id),
    [app.snapshot, project.id],
  )

  const due = project.dueAt ? logicalDay(project.dueAt, boundaryHour) : null
  const remaining = due ? daysBetween(due, app.today) : null
  const overdue = remaining !== null && remaining < 0 && project.status !== 'done'
  const waiting = [...groups.todo, ...groups.held]

  return (
    <div className="screen">
      <div className="project-detail__head">
        <button type="button" className="link-btn" onClick={onBack}>
          ← 목록
        </button>
      </div>
      <h1 className={overdue ? 'project-title project-title--overdue' : 'project-title'}>
        {project.name}
      </h1>

      <section className="card">
        <div className="card__head">
          <span className="project-count">
            {progress.done}/{progress.total} 완료
          </span>
          {due && project.dueAt && (
            <span className="todo-due">
              {formatDueLabel(project.dueAt)}
              <span className={overdue ? 'dday-chip dday-chip--past' : 'dday-chip'}>
                {remaining === null ? '' : formatRemaining(remaining)}
              </span>
              <AlertChips dueAt={project.dueAt} done={project.status === 'done'} />
            </span>
          )}
        </div>
        <span className="project-bar">
          <span className="project-bar__fill" style={{ width: `${progress.percent}%` }} />
        </span>
        <label className="project-start todo-meta">
          시작일
          <input
            type="date"
            value={dueDateValue(project.startAt)}
            aria-label="프로젝트 시작일"
            onChange={(e) => void api.editProject(project, { startAt: toDueAt(e.target.value) })}
          />
        </label>
        <div className="project-status btn-row">
          {PROJECT_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={project.status === status}
              onClick={() => void api.setProjectStatus(project, status)}
            >
              {PROJECT_STATUS_LABEL[status]}
            </button>
          ))}
        </div>
      </section>

      <ProjectNote project={project} />
      <ProjectChecklist project={project} />

      <TaskComposer projectId={project.id} />

      <TaskGroup title="진행 중" tasks={groups.doing} boundaryHour={boundaryHour} today={app.today} />
      <TaskGroup title="대기" tasks={waiting} boundaryHour={boundaryHour} today={app.today} />

      {groups.done.length > 0 && (
        <section className="card">
          <button
            type="button"
            className="link-btn"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
          >
            완료한 작업 {groups.done.length}건 {showDone ? '접기' : '펼치기'}
          </button>
          {showDone && (
            <ul className="todo-list">
              {groups.done.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  boundaryHour={boundaryHour}
                  today={app.today}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {meetings.length > 0 && (
        <section className="card project-meetings">
          <div className="card__head">
            <h2>회의록</h2>
            <span className="badge">{meetings.length}</span>
          </div>
          <ul className="todo-list">
            {meetings.map((meeting) =>
              onOpenMeeting ? (
                <li key={meeting.id} className="project-meeting">
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => onOpenMeeting(meeting)}
                  >
                    {meeting.title || '제목 없는 회의록'}
                  </button>
                  <span className="todo-meta">{formatMoment(meeting.at)}</span>
                </li>
              ) : (
                <li key={meeting.id} className="project-meeting">
                  <span className="todo-title">{meeting.title || '제목 없는 회의록'}</span>
                  <span className="todo-meta">{formatMoment(meeting.at)}</span>
                </li>
              ),
            )}
          </ul>
        </section>
      )}

      <section className="card">
        {confirming ? (
          <div className="btn-row">
            <span className="hint">
              프로젝트를 지우면 남은 작업은 개인 할 일로 돌아갑니다.
            </span>
            <button
              type="button"
              className="danger"
              onClick={() => {
                void api.removeProject(project)
                onBack()
              }}
            >
              정말 삭제
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              취소
            </button>
          </div>
        ) : (
          <button type="button" className="danger" onClick={() => setConfirming(true)}>
            프로젝트 삭제
          </button>
        )}
      </section>
    </div>
  )
}

function ProjectNote({ project }: { project: Project }) {
  const api = useProjects()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const summary = noteSummary(project)

  const save = () => {
    void api.editProject(project, { note: draft.trim() === '' ? undefined : draft })
    setOpen(false)
  }

  return (
    <section className="card project-fold">
      <div className="card__head">
        <button
          type="button"
          className="link-btn"
          aria-expanded={open}
          onClick={() => {
            if (open) {
              setOpen(false)
              return
            }
            setDraft(project.note ?? '')
            setOpen(true)
          }}
        >
          메모 {open ? '접기' : '펼치기'}
        </button>
        {!open && summary !== '' && <span className="project-note__line">{summary}</span>}
      </div>

      {open && (
        <>
          <textarea
            className="project-note__input"
            value={draft}
            rows={4}
            placeholder="프로젝트 메모"
            aria-label="프로젝트 메모"
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="btn-row">
            <button type="button" onClick={save}>
              메모 저장
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              메모 취소
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function ProjectChecklist({ project }: { project: Project }) {
  const api = useProjects()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const items = projectChecklist(project)
  const progress = checklistProgress(project)

  const submit = () => {
    if (!text.trim()) return
    void api.addChecklistItem(project, text)
    setText('')
  }

  return (
    <section className="card project-fold">
      <div className="card__head">
        <button
          type="button"
          className="link-btn"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          체크리스트 {open ? '접기' : '펼치기'}
        </button>
        <span className="project-count">
          {progress.done}/{progress.total}
        </span>
      </div>

      {open && (
        <>
          <form
            className="composer project-check-composer"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <input
              type="text"
              value={text}
              placeholder="체크리스트 항목"
              onChange={(e) => setText(e.target.value)}
              aria-label="체크리스트 항목"
            />
            <div className="composer__row">
              <button type="submit" disabled={!text.trim()}>
                항목 추가
              </button>
            </div>
          </form>

          {items.length === 0 ? (
            <p className="empty">체크리스트 항목이 없습니다.</p>
          ) : (
            <ul className="project-checklist">
              {items.map((item) => (
                <ChecklistRow key={item.id} project={project} item={item} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function ChecklistRow({ project, item }: { project: Project; item: ChecklistItem }) {
  const api = useProjects()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.text)

  if (editing) {
    return (
      <li className="project-check-row">
        <input
          type="text"
          value={draft}
          aria-label={`${item.text} 항목 수정`}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            void api.editChecklistItem(project, item.id, draft)
            setEditing(false)
          }}
        >
          저장
        </button>
        <button type="button" className="link-btn" onClick={() => setEditing(false)}>
          취소
        </button>
      </li>
    )
  }

  return (
    <li className="project-check-row">
      <button
        type="button"
        className={item.done ? 'check check--on' : 'check'}
        aria-pressed={item.done}
        aria-label={`${item.text} 체크 토글`}
        onClick={() => void api.toggleChecklistItem(project, item.id)}
      />
      <span
        className={
          item.done ? 'project-check-text project-check-text--done' : 'project-check-text'
        }
      >
        {item.text}
      </span>
      <button
        type="button"
        className="link-btn"
        aria-label={`${item.text} 항목 고치기`}
        onClick={() => {
          setDraft(item.text)
          setEditing(true)
        }}
      >
        수정
      </button>
      <button
        type="button"
        className="icon-btn icon-btn--danger"
        aria-label={`${item.text} 항목 삭제`}
        onClick={() => void api.removeChecklistItem(project, item.id)}
      >
        ×
      </button>
    </li>
  )
}

function TaskComposer({ projectId }: { projectId: string }) {
  const api = useProjects()
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [due, setDue] = useState('')
  const [dueTime, setDueTime] = useState('')

  const submit = () => {
    if (!title.trim()) return
    void api.addTask(projectId, {
      title,
      assignee: assignee.trim() || undefined,
      dueAt: toDueAt(due, dueTime),
    })
    setTitle('')
    setAssignee('')
    setDue('')
    setDueTime('')
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
        placeholder="작업 추가"
        onChange={(e) => setTitle(e.target.value)}
        aria-label="작업 제목"
      />
      <input
        type="text"
        value={assignee}
        placeholder="담당 메모"
        onChange={(e) => setAssignee(e.target.value)}
        aria-label="담당 메모"
      />
      <div className="composer__row">
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="작업 기한"
        />
        <input
          type="time"
          value={dueTime}
          onChange={(e) => setDueTime(e.target.value)}
          aria-label="작업 기한 시각"
        />
        <button type="submit" disabled={!title.trim()}>
          작업 추가
        </button>
      </div>
    </form>
  )
}

function TaskGroup({
  title,
  tasks,
  boundaryHour,
  today,
}: {
  title: string
  tasks: Todo[]
  boundaryHour: number
  today: string
}) {
  return (
    <section className="card project-group">
      <div className="card__head">
        <h2>{title}</h2>
        <span className="project-count">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="empty">{title} 작업이 없습니다.</p>
      ) : (
        <ul className="todo-list">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} boundaryHour={boundaryHour} today={today} />
          ))}
        </ul>
      )}
    </section>
  )
}

function TaskRow({
  task,
  boundaryHour,
  today,
}: {
  task: Todo
  boundaryHour: number
  today: string
}) {
  const api = useProjects()
  const todoApi = useTodos()
  const due = task.dueAt ? logicalDay(task.dueAt, boundaryHour) : null
  const remaining = due ? daysBetween(due, today) : null
  const overdue = remaining !== null && remaining < 0 && task.status !== 'done'

  return (
    <li className={overdue ? 'project-task todo todo--overdue' : 'project-task todo'}>
      <select
        className="project-select"
        value={task.status}
        aria-label={`${task.title} 상태`}
        onChange={(e) => void api.setTaskStatus(task, e.target.value as TodoStatus)}
      >
        {(['doing', 'todo', 'held', 'done'] as TodoStatus[]).map((status) => (
          <option key={status} value={status}>
            {TASK_STATUS_LABEL[status]}
          </option>
        ))}
      </select>
      <div className="todo__text">
        <span className={task.status === 'done' ? 'todo-title todo-title--done' : 'todo-title'}>
          {task.title}
        </span>
        {task.assignee && (
          <span className="todo-meta">
            <span className="project-assignee">{task.assignee}</span>
          </span>
        )}
        <DueEditor todo={task} remaining={remaining} overdue={overdue} />
      </div>
      <button
        type="button"
        className="link-btn"
        onClick={() => void api.moveTask(task, undefined)}
      >
        개인으로
      </button>
      <button
        type="button"
        className="icon-btn icon-btn--danger"
        onClick={() => void todoApi.removeTodo(task)}
        aria-label={`${task.title} 삭제`}
      >
        ×
      </button>
    </li>
  )
}

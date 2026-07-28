import { useMemo, useState } from 'react'
import { daysBetween, logicalDay } from '../lib/day'
import { formatRemaining } from '../lib/select'
import {
  projectMeetings,
  projectProgress,
  projectTasks,
  tasksByStatus,
} from '../lib/selectProjects'
import type { Journal, Project, ProjectStatus, Todo, TodoStatus } from '../lib/types'
import { useApp } from '../state/app'
import { useProjects } from '../state/projects'
import { useTodos } from '../state/todos'

export const ALERT_OFFSETS = [48, 24, 2, 1]

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

export function AlertChips({ dueAt }: { dueAt?: string | undefined }) {
  if (!dueAt) return null
  return (
    <span className="project-alerts" aria-label="알림 예정">
      {ALERT_OFFSETS.map((h) => (
        <span key={h} className="project-alert">
          {h}h
        </span>
      ))}
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
  const [due, setDue] = useState('')

  const submit = () => {
    if (!name.trim()) return
    void (async () => {
      const project = await api.addProject({
        name,
        dueAt: due ? new Date(`${due}T12:00:00`).toISOString() : undefined,
      })
      onCreated?.(project)
    })()
    setName('')
    setDue('')
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
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="프로젝트 마감일"
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
          {due && (
            <span className="todo-due">
              {due}
              <span className={overdue ? 'dday-chip dday-chip--past' : 'dday-chip'}>
                {remaining === null ? '' : formatRemaining(remaining)}
              </span>
              <AlertChips dueAt={project.dueAt} />
            </span>
          )}
        </div>
        <span className="project-bar">
          <span className="project-bar__fill" style={{ width: `${progress.percent}%` }} />
        </span>
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

function TaskComposer({ projectId }: { projectId: string }) {
  const api = useProjects()
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [due, setDue] = useState('')

  const submit = () => {
    if (!title.trim()) return
    void api.addTask(projectId, {
      title,
      assignee: assignee.trim() || undefined,
      dueAt: due ? new Date(`${due}T12:00:00`).toISOString() : undefined,
    })
    setTitle('')
    setAssignee('')
    setDue('')
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
        {(task.assignee || due) && (
          <span className="todo-meta">
            {task.assignee && <span className="project-assignee">{task.assignee}</span>}
            {due && <span>{due}</span>}
            {due && remaining !== null && task.status !== 'done' && (
              <span className={overdue ? 'dday-chip dday-chip--past' : 'dday-chip'}>
                {formatRemaining(remaining)}
              </span>
            )}
            <AlertChips dueAt={task.dueAt} />
          </span>
        )}
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

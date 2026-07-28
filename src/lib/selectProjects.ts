import type { Snapshot } from '../data/store'
import type { ChecklistItem, Journal, Project, ProjectStatus, Todo, TodoStatus } from './types'

export const TASK_STATUSES: TodoStatus[] = ['doing', 'todo', 'held', 'done']
export const NOTE_SUMMARY_LIMIT = 40

const PROJECT_RANK: Record<ProjectStatus, number> = { active: 0, held: 1, done: 2 }

export interface ProjectProgress {
  done: number
  total: number
  percent: number
}

export interface ChecklistProgress {
  done: number
  total: number
}

function byDueThenCreated(a: Todo, b: Todo): number {
  if (a.dueAt && b.dueAt && a.dueAt !== b.dueAt) return a.dueAt.localeCompare(b.dueAt)
  if (a.dueAt && !b.dueAt) return -1
  if (!a.dueAt && b.dueAt) return 1
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

export function liveProjects(snapshot: Snapshot): Project[] {
  return snapshot.projects.filter((p) => !p.deleted)
}

export function sortedProjects(snapshot: Snapshot): Project[] {
  return liveProjects(snapshot).sort(
    (a, b) =>
      PROJECT_RANK[a.status] - PROJECT_RANK[b.status] ||
      a.order - b.order ||
      a.createdAt.localeCompare(b.createdAt),
  )
}

export function projectTasks(snapshot: Snapshot, projectId: string): Todo[] {
  return snapshot.todos
    .filter((t) => !t.deleted && t.projectId === projectId)
    .sort(byDueThenCreated)
}

export function personalTodos(snapshot: Snapshot): Todo[] {
  return snapshot.todos.filter((t) => !t.deleted && !t.projectId)
}

export function projectProgress(snapshot: Snapshot, project: Project): ProjectProgress {
  const tasks = projectTasks(snapshot, project.id)
  const total = tasks.length
  const done = tasks.filter((t) => t.status === 'done').length
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) }
}

export function tasksByStatus(tasks: Todo[]): Record<TodoStatus, Todo[]> {
  const groups: Record<TodoStatus, Todo[]> = { todo: [], doing: [], done: [], held: [] }
  for (const task of tasks) groups[task.status].push(task)
  return groups
}

function isChecklistItem(raw: unknown): raw is ChecklistItem {
  if (typeof raw !== 'object' || raw === null) return false
  const item = raw as Partial<ChecklistItem>
  return typeof item.id === 'string' && typeof item.text === 'string'
}

export function projectChecklist(project: Project): ChecklistItem[] {
  if (!Array.isArray(project.checklist)) return []
  return project.checklist
    .filter(isChecklistItem)
    .map((item) => ({ id: item.id, text: item.text, done: item.done === true }))
}

export function checklistProgress(project: Project): ChecklistProgress {
  const items = projectChecklist(project)
  return { done: items.filter((item) => item.done).length, total: items.length }
}

export function summarizeNote(
  note: string | undefined,
  limit: number = NOTE_SUMMARY_LIMIT,
): string {
  if (typeof note !== 'string') return ''
  const line = note
    .split('\n')
    .map((raw) => raw.trim())
    .find((raw) => raw !== '')
  if (line === undefined) return ''
  const max = Math.max(1, Math.trunc(limit))
  return line.length <= max ? line : `${line.slice(0, max)}…`
}

export function noteSummary(project: Project, limit: number = NOTE_SUMMARY_LIMIT): string {
  return summarizeNote(project.note, limit)
}

export function todoNoteSummary(todo: Todo, limit: number = NOTE_SUMMARY_LIMIT): string {
  return summarizeNote(todo.note, limit)
}

export function todoPlace(todo: Todo): string {
  return typeof todo.place === 'string' ? todo.place.trim() : ''
}

export function projectMeetings(snapshot: Snapshot, projectId: string): Journal[] {
  return snapshot.journal
    .filter((j) => !j.deleted && j.kind === 'meeting' && j.projectId === projectId)
    .sort((a, b) => b.at.localeCompare(a.at) || b.createdAt.localeCompare(a.createdAt))
}

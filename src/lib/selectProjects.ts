import type { Snapshot } from '../data/store'
import type { Journal, Project, ProjectStatus, Todo, TodoStatus } from './types'

export const TASK_STATUSES: TodoStatus[] = ['doing', 'todo', 'held', 'done']

const PROJECT_RANK: Record<ProjectStatus, number> = { active: 0, held: 1, done: 2 }

export interface ProjectProgress {
  done: number
  total: number
  percent: number
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

export function projectMeetings(snapshot: Snapshot, projectId: string): Journal[] {
  return snapshot.journal
    .filter((j) => !j.deleted && j.kind === 'meeting' && j.projectId === projectId)
    .sort((a, b) => b.at.localeCompare(a.at) || b.createdAt.localeCompare(a.createdAt))
}

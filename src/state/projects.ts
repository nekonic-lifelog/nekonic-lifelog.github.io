import { useMemo } from 'react'
import { newId } from '../lib/ids'
import { projectChecklist } from '../lib/selectProjects'
import type { ChecklistItem, Project, ProjectStatus, Todo, TodoStatus } from '../lib/types'
import { createBase, softDelete, touch } from '../data/mutations'
import { useApp } from './app'

export interface NewProject {
  name: string
  startAt?: string | undefined
  dueAt?: string | undefined
  note?: string | undefined
  checklist?: ChecklistItem[] | undefined
}

export interface NewTask {
  title: string
  dueAt?: string | undefined
  assignee?: string | undefined
}

export type ProjectPatch = Partial<
  Pick<Project, 'name' | 'startAt' | 'dueAt' | 'status' | 'order' | 'note' | 'checklist'>
>

export interface ProjectsApi {
  addProject(input: NewProject): Promise<Project>
  editProject(project: Project, patch: ProjectPatch): Promise<void>
  setProjectStatus(project: Project, status: ProjectStatus): Promise<void>
  reorderProject(project: Project, order: number): Promise<void>
  removeProject(project: Project): Promise<void>
  addTask(projectId: string, input: NewTask): Promise<Todo>
  setTaskStatus(task: Todo, status: TodoStatus): Promise<void>
  moveTask(task: Todo, projectId: string | undefined): Promise<void>
  addChecklistItem(project: Project, text: string): Promise<void>
  toggleChecklistItem(project: Project, itemId: string): Promise<void>
  editChecklistItem(project: Project, itemId: string, text: string): Promise<void>
  removeChecklistItem(project: Project, itemId: string): Promise<void>
}

function asPersonalStatus(status: TodoStatus): TodoStatus {
  return status === 'done' ? 'done' : 'todo'
}

function cleanNote(note: string | undefined): string | undefined {
  if (typeof note !== 'string') return undefined
  return note.trim() === '' ? undefined : note
}

export function useProjects(): ProjectsApi {
  const { snapshot, clock, ctx, write } = useApp()

  return useMemo<ProjectsApi>(
    () => ({
      async addProject(input) {
        const maxOrder = snapshot.projects.reduce(
          (max, p) => (p.deleted ? max : Math.max(max, p.order)),
          -1,
        )
        const project: Project = {
          ...createBase(ctx),
          name: input.name.trim(),
          status: 'active',
          startAt: input.startAt,
          dueAt: input.dueAt,
          order: maxOrder + 1,
          note: cleanNote(input.note),
          checklist: Array.isArray(input.checklist) ? input.checklist : undefined,
        }
        await write('projects', [project])
        return project
      },

      async editProject(project, patch) {
        await write('projects', [touch({ ...project, ...patch }, ctx)])
      },

      async setProjectStatus(project, status) {
        await write('projects', [touch({ ...project, status }, ctx)])
      },

      async reorderProject(project, order) {
        await write('projects', [touch({ ...project, order }, ctx)])
      },

      async removeProject(project) {
        const released = snapshot.todos
          .filter((t) => !t.deleted && t.projectId === project.id && t.status !== 'done')
          .map((t) =>
            touch(
              { ...t, projectId: undefined, status: asPersonalStatus(t.status) },
              ctx,
            ),
          )
        await write('projects', [softDelete(project, ctx)])
        await write('todos', released)
      },

      async addTask(projectId, input) {
        const task: Todo = {
          ...createBase(ctx),
          title: input.title.trim(),
          status: 'todo',
          dueAt: input.dueAt,
          projectId,
          assignee: input.assignee?.trim() || undefined,
          pinned: false,
        }
        await write('todos', [task])
        return task
      },

      async setTaskStatus(task, status) {
        const doneAt = status === 'done' ? new Date(clock.now()).toISOString() : undefined
        await write('todos', [touch({ ...task, status, doneAt }, ctx)])
      },

      async moveTask(task, projectId) {
        const status = projectId === undefined ? asPersonalStatus(task.status) : task.status
        await write('todos', [touch({ ...task, projectId, status }, ctx)])
      },

      async addChecklistItem(project, text) {
        const trimmed = text.trim()
        if (trimmed === '') return
        const item: ChecklistItem = { id: newId(), text: trimmed, done: false }
        const checklist = [...projectChecklist(project), item]
        await write('projects', [touch({ ...project, checklist }, ctx)])
      },

      async toggleChecklistItem(project, itemId) {
        const items = projectChecklist(project)
        if (!items.some((item) => item.id === itemId)) return
        const checklist = items.map((item) =>
          item.id === itemId ? { ...item, done: !item.done } : item,
        )
        await write('projects', [touch({ ...project, checklist }, ctx)])
      },

      async editChecklistItem(project, itemId, text) {
        const trimmed = text.trim()
        if (trimmed === '') return
        const items = projectChecklist(project)
        if (!items.some((item) => item.id === itemId)) return
        const checklist = items.map((item) =>
          item.id === itemId ? { ...item, text: trimmed } : item,
        )
        await write('projects', [touch({ ...project, checklist }, ctx)])
      },

      async removeChecklistItem(project, itemId) {
        const items = projectChecklist(project)
        const checklist = items.filter((item) => item.id !== itemId)
        if (checklist.length === items.length) return
        await write('projects', [touch({ ...project, checklist }, ctx)])
      },
    }),
    [snapshot, clock, ctx, write],
  )
}

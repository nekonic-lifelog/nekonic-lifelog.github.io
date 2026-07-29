import type { Snapshot } from '../data/store'
import { addDays, dayKeyToDate, weekdayLabel, weekdayOf, type DayKey } from './day'
import { dueDayOf } from './select'
import type { Project, Todo } from './types'

export type TodoGroupKind = 'overdue' | 'today' | 'tomorrow' | 'day' | 'undated'

export interface TodoGroupItem {
  todo: Todo
  project?: Project | undefined
}

export interface TodoGroup {
  key: string
  kind: TodoGroupKind
  title: string
  day: DayKey | null
  items: TodoGroupItem[]
}

export const OVERDUE_TITLE = '지난 기한'
export const TODAY_TITLE = '오늘'
export const TOMORROW_TITLE = '내일'
export const UNDATED_TITLE = '기한 없는 할 일'

export function dayGroupTitle(day: DayKey): string {
  const d = dayKeyToDate(day)
  return `${d.getMonth() + 1}/${d.getDate()} (${weekdayLabel(weekdayOf(day))})`
}

function byDueThenCreated(a: TodoGroupItem, b: TodoGroupItem): number {
  return (
    (a.todo.dueAt ?? '').localeCompare(b.todo.dueAt ?? '') ||
    a.todo.createdAt.localeCompare(b.todo.createdAt) ||
    a.todo.id.localeCompare(b.todo.id)
  )
}

function byCreated(a: TodoGroupItem, b: TodoGroupItem): number {
  return (
    a.todo.createdAt.localeCompare(b.todo.createdAt) || a.todo.id.localeCompare(b.todo.id)
  )
}

export interface DayTodos {
  overdue: TodoGroupItem[]
  due: TodoGroupItem[]
}

export function todosForDay(
  snapshot: Snapshot,
  day: DayKey,
  boundaryHour: number,
): DayTodos {
  const groups = groupTodosByDue(snapshot, day, boundaryHour)
  return {
    overdue: groups.find((g) => g.kind === 'overdue')?.items ?? [],
    due: groups.find((g) => g.kind === 'today')?.items ?? [],
  }
}

export function groupTodosByDue(
  snapshot: Snapshot,
  today: DayKey,
  boundaryHour: number,
): TodoGroup[] {
  const byId = new Map<string, Project>()
  for (const project of snapshot.projects) {
    if (!project.deleted) byId.set(project.id, project)
  }

  const overdue: TodoGroupItem[] = []
  const undated: TodoGroupItem[] = []
  const dated = new Map<DayKey, TodoGroupItem[]>()

  for (const todo of snapshot.todos) {
    if (todo.deleted || todo.status === 'done') continue
    const project = todo.projectId ? byId.get(todo.projectId) : undefined
    const due = dueDayOf(todo, boundaryHour)

    if (!due) {
      if (project) continue
      undated.push({ todo, project: undefined })
      continue
    }
    if (due < today) {
      overdue.push({ todo, project })
      continue
    }
    const bucket = dated.get(due)
    if (bucket) bucket.push({ todo, project })
    else dated.set(due, [{ todo, project }])
  }

  const tomorrow = addDays(today, 1)
  const groups: TodoGroup[] = []

  if (overdue.length > 0) {
    groups.push({
      key: 'overdue',
      kind: 'overdue',
      title: OVERDUE_TITLE,
      day: null,
      items: overdue.sort(byDueThenCreated),
    })
  }

  for (const day of [...dated.keys()].sort()) {
    const items = (dated.get(day) ?? []).sort(byDueThenCreated)
    if (day === today) {
      groups.push({ key: 'today', kind: 'today', title: TODAY_TITLE, day, items })
    } else if (day === tomorrow) {
      groups.push({ key: 'tomorrow', kind: 'tomorrow', title: TOMORROW_TITLE, day, items })
    } else {
      groups.push({ key: day, kind: 'day', title: dayGroupTitle(day), day, items })
    }
  }

  if (undated.length > 0) {
    groups.push({
      key: 'undated',
      kind: 'undated',
      title: UNDATED_TITLE,
      day: null,
      items: undated.sort(byCreated),
    })
  }

  return groups
}

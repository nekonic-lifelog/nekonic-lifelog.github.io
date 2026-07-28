import { DEFAULT_OFFSETS, DEFAULT_TZ } from './reminders'
import type { ReminderChannel, RecurringReminder } from './reminders'

export const SCHEMA_VERSION = 1

export interface Base {
  id: string
  v: number
  createdAt: string
  deviceId: string
  updatedAt: string
  deleted: boolean
}

export type DefinitionKind = 'check' | 'quantity'

export interface TargetPoint {
  from: string
  target: number
}

export interface Definition extends Base {
  kind: DefinitionKind
  name: string
  unit?: string | undefined
  targetHistory: TargetPoint[]
  targetDays?: number[] | undefined
  order: number
  hidden: boolean
  archived: boolean
}

export interface LogRecord extends Base {
  defId: string
  at: string
  value: number
  note?: string | undefined
}

export type TodoStatus = 'todo' | 'doing' | 'done' | 'held'

export interface Todo extends Base {
  title: string
  status: TodoStatus
  dueAt?: string | undefined
  doneAt?: string | undefined
  projectId?: string | undefined
  assignee?: string | undefined
  pinned: boolean
  sourceId?: string | undefined
  note?: string | undefined
}

export type ProjectStatus = 'active' | 'held' | 'done'

export interface Project extends Base {
  name: string
  status: ProjectStatus
  startAt?: string | undefined
  dueAt?: string | undefined
  order: number
}

export type BookStatus = 'reading' | 'finished' | 'dropped'

export interface Book extends Base {
  defId: string
  title: string
  author?: string | undefined
  totalPages?: number | undefined
  status: BookStatus
  rating?: number | undefined
  startedAt?: string | undefined
  finishedAt?: string | undefined
  note?: string | undefined
}

export type JournalKind = 'diary' | 'meeting' | 'memo'

export interface Journal extends Base {
  kind: JournalKind
  at: string
  title?: string | undefined
  body: string
  projectId?: string | undefined
  attendees?: string[] | undefined
}

export interface Settings {
  dayBoundaryHour: number
  tz: string
  notifyChannel: ReminderChannel
  defaultOffsets: number[]
  recurring: RecurringReminder[]
  maskProjectLabels: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  dayBoundaryHour: 4,
  tz: DEFAULT_TZ,
  notifyChannel: 'discord',
  defaultOffsets: [...DEFAULT_OFFSETS],
  recurring: [],
  maskProjectLabels: true,
}

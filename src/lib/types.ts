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

export interface Settings {
  dayBoundaryHour: number
}

export const DEFAULT_SETTINGS: Settings = { dayBoundaryHour: 4 }

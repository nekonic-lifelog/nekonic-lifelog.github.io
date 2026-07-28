import type { Definition, LogRecord, Settings, Todo } from '../lib/types'

export type TableName = 'definitions' | 'records' | 'todos'

export interface RowTypes {
  definitions: Definition
  records: LogRecord
  todos: Todo
}

export interface Snapshot {
  definitions: Definition[]
  records: LogRecord[]
  todos: Todo[]
  settings: Settings
}

export interface Store {
  deviceId(): Promise<string>
  loadAll(): Promise<Snapshot>
  put<K extends TableName>(table: K, rows: RowTypes[K][]): Promise<void>
  putSettings(settings: Settings): Promise<void>
  replaceAll(snapshot: Snapshot): Promise<void>
}

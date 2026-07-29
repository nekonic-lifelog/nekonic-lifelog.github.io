import type {
  Book,
  Definition,
  Journal,
  JournalKind,
  LogRecord,
  Project,
  Settings,
  Todo,
} from '../lib/types'

export type TableName =
  | 'definitions'
  | 'records'
  | 'todos'
  | 'projects'
  | 'books'
  | 'journal'

export interface RowTypes {
  definitions: Definition
  records: LogRecord
  todos: Todo
  projects: Project
  books: Book
  journal: Journal
}

export interface Snapshot {
  definitions: Definition[]
  records: LogRecord[]
  todos: Todo[]
  projects: Project[]
  books: Book[]
  journal: Journal[]
  settings: Settings
}

export interface JournalDraft {
  key: string
  kind: JournalKind
  title: string
  body: string
  projectId: string
  bookId: string
  attendees: string
  savedAt: string
}

export interface DraftStore {
  loadDraft(key: string): Promise<JournalDraft | null>
  saveDraft(draft: JournalDraft): Promise<void>
  clearDraft(key: string): Promise<void>
}

export interface Store {
  deviceId(): Promise<string>
  adoptDeviceId(id: string): Promise<void>
  loadAll(): Promise<Snapshot>
  put<K extends TableName>(table: K, rows: RowTypes[K][]): Promise<void>
  putSettings(settings: Settings): Promise<void>
  replaceAll(snapshot: Snapshot): Promise<void>
}

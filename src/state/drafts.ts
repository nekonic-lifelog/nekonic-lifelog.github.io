import { createContext, useContext } from 'react'
import type { DraftStore, JournalDraft } from '../data/store'
import type { Journal, JournalKind } from '../lib/types'

export const DraftCtx = createContext<DraftStore | null>(null)

export function memoryDraftStore(): DraftStore {
  const kept = new Map<string, JournalDraft>()
  return {
    async loadDraft(key) {
      return kept.get(key) ?? null
    },
    async saveDraft(draft) {
      kept.set(draft.key, draft)
    },
    async clearDraft(key) {
      kept.delete(key)
    },
  }
}

export function draftStoreOf(store: Partial<DraftStore>): DraftStore {
  return store.loadDraft && store.saveDraft && store.clearDraft
    ? (store as DraftStore)
    : memoryDraftStore()
}

export function useDraftStore(): DraftStore {
  const store = useContext(DraftCtx)
  if (!store) throw new Error('AppProvider 밖에서 useDraftStore를 불렀습니다')
  return store
}

export function draftKey(entry: Journal | null, kind: JournalKind): string {
  return entry === null ? `new:${kind}` : `entry:${entry.id}`
}

export function draftFields(entry: Journal | null): Omit<JournalDraft, 'key' | 'kind' | 'savedAt'> {
  return {
    title: entry?.title ?? '',
    body: entry?.body ?? '',
    projectId: entry?.projectId ?? '',
    bookId: entry?.bookId ?? '',
    attendees: (entry?.attendees ?? []).join(', '),
  }
}

export function sameFields(
  a: Omit<JournalDraft, 'key' | 'kind' | 'savedAt'>,
  b: Omit<JournalDraft, 'key' | 'kind' | 'savedAt'>,
): boolean {
  return (
    a.title === b.title &&
    a.body === b.body &&
    a.projectId === b.projectId &&
    a.bookId === b.bookId &&
    a.attendees === b.attendees
  )
}

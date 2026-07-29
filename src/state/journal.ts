import { useMemo } from 'react'
import type { Journal, JournalKind, Todo } from '../lib/types'
import { createBase, softDelete, touch } from '../data/mutations'
import { useApp } from './app'

export interface NewJournal {
  kind: JournalKind
  at?: string | undefined
  title?: string | undefined
  body: string
  projectId?: string | undefined
  bookId?: string | undefined
  attendees?: string[] | undefined
}

export type JournalPatch = Partial<
  Pick<Journal, 'at' | 'title' | 'body' | 'projectId' | 'bookId' | 'attendees'>
>

export interface JournalApi {
  addJournal(input: NewJournal): Promise<Journal>
  editJournal(entry: Journal, patch: JournalPatch): Promise<void>
  removeJournal(entry: Journal): Promise<void>
  actionItemsToTodos(entry: Journal, titles: string[]): Promise<void>
}

function cleanTitle(title: string | undefined): string | undefined {
  const trimmed = title?.trim()
  return trimmed ? trimmed : undefined
}

function cleanAttendees(list: string[] | undefined): string[] | undefined {
  if (!list) return undefined
  const names = list.map((n) => n.trim()).filter((n) => n.length > 0)
  return names.length > 0 ? names : undefined
}

export function useJournal(): JournalApi {
  const { clock, ctx, write } = useApp()

  return useMemo<JournalApi>(
    () => ({
      async addJournal(input) {
        const entry: Journal = {
          ...createBase(ctx),
          kind: input.kind,
          at: input.at ?? new Date(clock.now()).toISOString(),
          title: cleanTitle(input.title),
          body: input.body,
          projectId: input.projectId,
          bookId: input.bookId,
          attendees: cleanAttendees(input.attendees),
        }
        await write('journal', [entry])
        return entry
      },

      async editJournal(entry, patch) {
        const next = { ...entry, ...patch }
        await write('journal', [
          touch(
            {
              ...next,
              title: cleanTitle(next.title),
              attendees: cleanAttendees(next.attendees),
            },
            ctx,
          ),
        ])
      },

      async removeJournal(entry) {
        await write('journal', [softDelete(entry, ctx)])
      },

      async actionItemsToTodos(entry, titles) {
        const todos = titles
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
          .map((title): Todo => ({
            ...createBase(ctx),
            title,
            status: 'todo',
            projectId: entry.projectId,
            pinned: false,
            sourceId: entry.id,
          }))
        await write('todos', todos)
      },
    }),
    [clock, ctx, write],
  )
}

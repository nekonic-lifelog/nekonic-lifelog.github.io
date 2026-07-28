import { useMemo } from 'react'
import { createBase, softDelete, touch } from '../data/mutations'
import { bookDefinition, bookSessions, pagesRead, totalPagesOf } from '../lib/selectBooks'
import { withNewTarget } from '../lib/streak'
import type { Book, BookStatus, Definition } from '../lib/types'
import { useApp, type AppApi } from './app'

export const PAGE_UNIT = '페이지'

export const MIN_RATING = 1
export const MAX_RATING = 5

export interface NewBook {
  title: string
  author?: string | undefined
  totalPages?: number | undefined
  startedAt?: string | undefined
}

export type BookPatch = Partial<
  Pick<Book, 'title' | 'author' | 'totalPages' | 'startedAt' | 'note'>
>

export interface BooksApi {
  addBook(input: NewBook): Promise<Book>
  editBook(book: Book, patch: BookPatch): Promise<void>
  setBookStatus(book: Book, status: BookStatus): Promise<void>
  rateBook(book: Book, rating: number): Promise<void>
  removeBook(book: Book): Promise<void>
  logProgress(book: Book, toPage: number, note?: string): Promise<void>
  undoLastSession(book: Book): Promise<void>
}

export function createBooksApi(app: AppApi): BooksApi {
  const nowIso = () => new Date(app.clock.now()).toISOString()

  const nextOrder = () =>
    app.snapshot.definitions.reduce(
      (max, d) => (d.deleted ? max : Math.max(max, d.order)),
      -1,
    ) + 1

  return {
    async addBook(input) {
      const title = input.title.trim()
      const total = input.totalPages !== undefined && input.totalPages > 0
        ? Math.round(input.totalPages)
        : undefined
      const defBase = createBase(app.ctx)
      const def: Definition = {
        ...defBase,
        kind: 'quantity',
        name: title,
        unit: PAGE_UNIT,
        targetHistory: total !== undefined ? [{ from: defBase.createdAt, target: total }] : [],
        order: nextOrder(),
        hidden: true,
        archived: false,
      }
      const book: Book = {
        ...createBase(app.ctx),
        defId: def.id,
        title,
        author: input.author?.trim() || undefined,
        totalPages: total,
        status: 'reading',
        startedAt: input.startedAt ?? defBase.createdAt,
      }
      await app.write('definitions', [def])
      await app.write('books', [book])
      return book
    },

    async editBook(book, patch) {
      const next: Book = { ...book, ...patch }
      next.title = next.title.trim()
      next.author = next.author?.trim() || undefined
      if (next.totalPages !== undefined && next.totalPages > 0) {
        next.totalPages = Math.round(next.totalPages)
      }

      const def = bookDefinition(book, app.snapshot)
      const changed: Definition[] = []
      if (def !== null) {
        let updated = def
        if (next.title.length > 0 && next.title !== def.name) {
          updated = { ...updated, name: next.title }
        }
        const total = totalPagesOf(next)
        if (total !== null && total !== book.totalPages) {
          updated = {
            ...updated,
            targetHistory: withNewTarget(
              def.targetHistory,
              total,
              nowIso(),
              app.boundaryHour,
            ),
          }
        }
        if (updated !== def) changed.push(touch(updated, app.ctx))
      }

      await app.write('books', [touch(next, app.ctx)])
      if (changed.length > 0) await app.write('definitions', changed)
    },

    async setBookStatus(book, status) {
      const finishedAt =
        status === 'finished' ? (book.finishedAt ?? nowIso()) : undefined
      await app.write('books', [touch({ ...book, status, finishedAt }, app.ctx)])
    },

    async rateBook(book, rating) {
      if (!Number.isFinite(rating)) return
      const clamped = Math.min(MAX_RATING, Math.max(MIN_RATING, Math.round(rating)))
      await app.write('books', [touch({ ...book, rating: clamped }, app.ctx)])
    },

    async removeBook(book) {
      const def = bookDefinition(book, app.snapshot)
      await app.write('books', [softDelete(book, app.ctx)])
      if (def !== null) await app.write('definitions', [softDelete(def, app.ctx)])
    },

    async logProgress(book, toPage, note) {
      if (!Number.isFinite(toPage)) return
      const def = bookDefinition(book, app.snapshot)
      if (def === null) return

      const total = totalPagesOf(book)
      const reached = total === null ? Math.round(toPage) : Math.min(Math.round(toPage), total)
      const delta = reached - pagesRead(book, app.snapshot)
      if (delta <= 0) return

      await app.write('records', [
        {
          ...createBase(app.ctx),
          defId: def.id,
          at: nowIso(),
          value: delta,
          note: note?.trim() || undefined,
        },
      ])
    },

    async undoLastSession(book) {
      const [newest] = bookSessions(book, app.snapshot)
      if (newest === undefined) return
      await app.write('records', [softDelete(newest, app.ctx)])
    },
  }
}

export function useBooks(): BooksApi {
  const app = useApp()
  return useMemo(() => createBooksApi(app), [app])
}

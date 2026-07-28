import { useMemo } from 'react'
import type { Todo, TodoStatus } from '../lib/types'
import { createBase, softDelete, touch } from '../data/mutations'
import { useApp } from './app'

export interface NewTodo {
  title: string
  dueAt?: string | undefined
  pinned?: boolean | undefined
  note?: string | undefined
}

export interface TodosApi {
  addTodo(input: NewTodo): Promise<void>
  editTodo(todo: Todo, patch: Partial<Todo>): Promise<void>
  setTodoStatus(todo: Todo, status: TodoStatus): Promise<void>
  removeTodo(todo: Todo): Promise<void>
}

export function useTodos(): TodosApi {
  const { clock, ctx, write } = useApp()

  return useMemo<TodosApi>(
    () => ({
      async addTodo(input) {
        const todo: Todo = {
          ...createBase(ctx),
          title: input.title.trim(),
          status: 'todo',
          dueAt: input.dueAt,
          pinned: input.pinned ?? false,
          note: input.note,
        }
        await write('todos', [todo])
      },

      async editTodo(todo, patch) {
        await write('todos', [touch({ ...todo, ...patch }, ctx)])
      },

      async setTodoStatus(todo, status) {
        const doneAt = status === 'done' ? new Date(clock.now()).toISOString() : undefined
        await write('todos', [touch({ ...todo, status, doneAt }, ctx)])
      },

      async removeTodo(todo) {
        await write('todos', [softDelete(todo, ctx)])
      },
    }),
    [clock, ctx, write],
  )
}

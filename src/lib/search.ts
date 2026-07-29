import type { Snapshot } from '../data/store'

export type SearchHitKind = 'journal' | 'todo'

export interface SearchHit {
  kind: SearchHitKind
  id: string
  title: string
  snippet: string
  at: string
}

export const SEARCH_MAX = 30

const SNIPPET_MAX = 80
const ELLIPSIS = '…'

export function searchTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0)
}

function hasAll(haystack: string, terms: string[]): boolean {
  const lower = haystack.toLowerCase()
  return terms.every((term) => lower.includes(term))
}

function hasAny(haystack: string, terms: string[]): boolean {
  const lower = haystack.toLowerCase()
  return terms.some((term) => lower.includes(term))
}

function cut(line: string): string {
  return line.length > SNIPPET_MAX ? `${line.slice(0, SNIPPET_MAX)}${ELLIPSIS}` : line
}

function snippetOf(body: string, terms: string[]): string {
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const found =
    lines.find((line) => hasAll(line, terms)) ??
    lines.find((line) => hasAny(line, terms)) ??
    lines[0]
  return found === undefined ? '' : cut(found)
}

function timeOf(at: string): number {
  const ms = new Date(at).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

function newestFirst(a: SearchHit, b: SearchHit): number {
  const at = timeOf(b.at) - timeOf(a.at)
  if (at !== 0) return at
  return a.id.localeCompare(b.id)
}

export function searchAll(
  snapshot: Snapshot,
  query: string,
  max: number = SEARCH_MAX,
): SearchHit[] {
  const terms = searchTerms(query)
  if (terms.length === 0) return []

  const hits: SearchHit[] = []

  for (const entry of snapshot.journal) {
    if (entry.deleted) continue
    const title = entry.title ?? ''
    if (!hasAll(`${title}\n${entry.body}`, terms)) continue
    hits.push({
      kind: 'journal',
      id: entry.id,
      title,
      snippet: snippetOf(entry.body, terms),
      at: entry.at,
    })
  }

  for (const todo of snapshot.todos) {
    if (todo.deleted) continue
    if (!hasAll(todo.title, terms)) continue
    hits.push({
      kind: 'todo',
      id: todo.id,
      title: todo.title,
      snippet: '',
      at: todo.dueAt ?? todo.createdAt,
    })
  }

  return hits.sort(newestFirst).slice(0, max)
}

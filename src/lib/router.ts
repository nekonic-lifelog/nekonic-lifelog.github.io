import { useSyncExternalStore } from 'react'

export const ROUTES = [
  '/today',
  '/todos',
  '/records',
  '/stats',
  '/dday',
  '/books',
  '/timer',
  '/link',
  '/settings',
] as const
export type Route = (typeof ROUTES)[number]

export interface Address {
  route: Route
  projectId?: string | undefined
}

const DEFAULT: Route = '/today'
const HOME: Address = { route: DEFAULT }
const PROJECT_PARAM = 'p'

export function parseAddress(hash: string): Address {
  const raw = hash.replace(/^#/, '')
  const cut = raw.indexOf('?')
  const path = cut < 0 ? raw : raw.slice(0, cut)
  if (!(ROUTES as readonly string[]).includes(path)) return HOME
  const route = path as Route
  if (route !== '/todos') return { route }
  const query = cut < 0 ? '' : raw.slice(cut + 1)
  const id = new URLSearchParams(query).get(PROJECT_PARAM)
  return id === null || id === '' ? { route } : { route, projectId: id }
}

export function projectHash(id: string): string {
  return `#/todos?${PROJECT_PARAM}=${encodeURIComponent(id)}`
}

let lastHash: string | null = null
let lastAddress: Address = HOME

export function readAddress(): Address {
  const hash = window.location.hash
  if (hash !== lastHash) {
    lastHash = hash
    lastAddress = parseAddress(hash)
  }
  return lastAddress
}

const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener('hashchange', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('hashchange', onChange)
  }
}

function announce(): void {
  for (const listener of [...listeners]) listener()
}

export function useAddress(): Address {
  return useSyncExternalStore(subscribe, readAddress, () => HOME)
}

export function useRoute(): Route {
  return useAddress().route
}

export function navigate(route: Route): void {
  window.location.hash = `#${route}`
  announce()
}

export function openProject(id: string): void {
  window.location.hash = projectHash(id)
  announce()
}

export function replaceRoute(route: Route): void {
  window.history.replaceState(null, '', `#${route}`)
  announce()
}

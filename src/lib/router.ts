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

const DEFAULT: Route = '/today'

function read(): Route {
  const path = window.location.hash.replace(/^#/, '')
  return (ROUTES as readonly string[]).includes(path) ? (path as Route) : DEFAULT
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, read, () => DEFAULT)
}

export function navigate(route: Route): void {
  window.location.hash = route
}

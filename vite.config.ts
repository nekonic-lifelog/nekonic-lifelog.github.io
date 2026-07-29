import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vitest/config'

const __dirname = dirname(fileURLToPath(import.meta.url))

const BASE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
]

const APP_CSP = [...BASE_CSP, "connect-src 'self' https://api.github.com"].join('; ')

const CHECK_CSP = [...BASE_CSP, "connect-src 'self'"].join('; ')

function cspMeta(): Plugin {
  return {
    name: 'lifelog-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html, ctx) => {
        const csp = ctx.path.includes('check') ? CHECK_CSP : APP_CSP
        return html.replace(
          '<head>',
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        )
      },
    },
  }
}

function walk(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory()
      ? walk(full, root)
      : ['/' + relative(root, full).split(sep).join(posix.sep)]
  })
}

function serviceWorker(): Plugin {
  let outDir = 'dist'
  return {
    name: 'lifelog-sw',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const precache = walk(outDir)
        .filter((p) => p !== '/sw.js')
        .sort()
      const digest = createHash('sha256')
      for (const path of precache) {
        digest.update(path)
        digest.update('\0')
        digest.update(readFileSync(join(outDir, path.slice(1))))
        digest.update('\0')
      }
      const version = digest.digest('hex').slice(0, 12)
      writeFileSync(
        join(outDir, 'sw.js'),
        swSource(version, precache),
        'utf8',
      )
    },
  }
}

function swSource(version: string, precache: string[]): string {
  return `const VERSION = ${JSON.stringify(version)}
const CACHE = 'lifelog-' + VERSION
const PRECACHE = ${JSON.stringify(precache, null, 2)}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetchAndPut(req)),
    )
    return
  }

  if (req.mode === 'navigate') {
    const shell = url.pathname.startsWith('/check') ? '/check.html' : '/index.html'
    event.respondWith(
      fetchAndPut(req).catch(
        () => caches.match(shell).then((hit) => hit || Response.error()),
      ),
    )
    return
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const net = fetchAndPut(req).catch(() => hit || Response.error())
      return hit || net
    }),
  )
})

function fetchAndPut(req) {
  return fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone()
      caches.open(CACHE).then((c) => c.put(req, copy))
    }
    return res
  })
}
`
}

export default defineConfig({
  plugins: [react(), cspMeta(), serviceWorker()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        check: resolve(__dirname, 'check.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    env: { TZ: 'Asia/Seoul' },
  },
})

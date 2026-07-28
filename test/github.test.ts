import { describe, expect, it, vi } from 'vitest'
import { GithubRepo } from '../src/remote/github'
import { REDACTED, scrubToken } from '../src/remote/tokenScrub'
import {
  AuthError,
  ConflictError,
  RateLimitError,
  RemoteError,
} from '../src/remote/types'
import type { CommitPlan, RemoteHead, RepoRef } from '../src/remote/types'
import { fromBase64, toBase64 } from '../src/crypto/kdf'

const TOKEN = 'test-token-do-not-use'
const REPO: RepoRef = { owner: 'nekonic', repo: 'lifelog', branch: 'main' }
const PREFIX = 'https://api.github.com/repos/nekonic/lifelog'

type Reply = (body: any, url: string) => Response

interface Call {
  url: string
  method: string
  body: any
  headers: Record<string, string>
}

function api(url: string): string {
  return url.startsWith(PREFIX) ? url.slice(PREFIX.length) : url
}

function json(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

function routed(routes: Record<string, Reply>) {
  return (url: string, init: RequestInit): Response => {
    const method = init.method ?? 'GET'
    const path = api(url).split('?')[0] ?? ''
    const key = `${method} ${path}`
    const reply = routes[key]
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
    if (!reply) return json({ message: `예상 밖 요청 ${key}` }, { status: 418 })
    return reply(body, url)
  }
}

function harness(handler: (url: string, init: RequestInit) => Response) {
  const calls: Call[] = []
  const sleeps: number[] = []
  const fetchImpl = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const raw = typeof init?.body === 'string' ? init.body : null
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: raw === null ? null : JSON.parse(raw),
      headers: (init?.headers ?? {}) as Record<string, string>,
    })
    return handler(url, init ?? {})
  }
  return {
    calls,
    sleeps,
    fetch: fetchImpl as unknown as typeof fetch,
    sleep: async (ms: number) => {
      sleeps.push(ms)
    },
  }
}

function makeRepo(
  handler: (url: string, init: RequestInit) => Response,
  maxAttempts?: number,
) {
  const h = harness(handler)
  const repo = new GithubRepo(
    REPO,
    TOKEN,
    maxAttempts === undefined
      ? { fetch: h.fetch, sleep: h.sleep }
      : { fetch: h.fetch, sleep: h.sleep, maxAttempts },
  )
  return { repo, ...h }
}

function trace(calls: Call[]): string[] {
  return calls.map((c) => `${c.method} ${api(c.url)}`)
}

function wrap(text: string): string {
  return (text.match(/.{1,60}/g) ?? []).join('\n')
}

const FILE = { path: 'data/records.bin', content: new Uint8Array([1, 2, 3]) }

function fullCommitRoutes(parentTree: string, newCommit: string): Record<string, Reply> {
  return {
    'GET /git/commits/c1': () => json({ sha: 'c1', tree: { sha: parentTree } }),
    'POST /git/blobs': () => json({ sha: 'blob-1' }),
    'POST /git/trees': () => json({ sha: 'tree-1' }),
    'POST /git/commits': () => json({ sha: newCommit }),
    'PATCH /git/refs/heads/main': () => json({ object: { sha: newCommit } }),
  }
}

describe('트리 읽기', () => {
  it('요청 한 번으로 전체 트리를 받고 blob만 담는다', async () => {
    const { repo, calls } = makeRepo(
      routed({
        'GET /git/trees/main': () =>
          json({
            sha: 'tree-root',
            truncated: false,
            tree: [
              { path: 'a.bin', sha: 'sha-a', size: 12, type: 'blob' },
              { path: 'data', sha: 'sha-dir', type: 'tree' },
              { path: 'data/b.bin', sha: 'sha-b', size: 34, type: 'blob' },
            ],
          }),
      }),
    )

    const index = await repo.readTree()

    expect(calls).toHaveLength(1)
    expect(api(calls[0]!.url)).toBe('/git/trees/main?recursive=1')
    expect(calls[0]!.method).toBe('GET')
    expect(index.entries).toEqual([
      { path: 'a.bin', sha: 'sha-a', size: 12 },
      { path: 'data/b.bin', sha: 'sha-b', size: 34 },
    ])
  })

  it('잘린 트리 표시를 그대로 전달한다', async () => {
    const { repo } = makeRepo(
      routed({
        'GET /git/trees/main': () => json({ truncated: true, tree: [] }),
      }),
    )
    expect((await repo.readTree()).truncated).toBe(true)
  })

  it('브랜치가 비어 있으면 빈 인덱스를 돌려준다', async () => {
    const { repo, calls, sleeps } = makeRepo(
      routed({
        'GET /git/trees/main': () => json({ message: 'Not Found' }, { status: 404 }),
      }),
    )
    expect(await repo.readTree()).toEqual({
      entries: [],
      truncated: false,
      commitSha: '',
    })
    expect(calls).toHaveLength(1)
    expect(sleeps).toEqual([])
  })

  it('빈 브랜치의 헤드는 커밋 없이 빈 트리다', async () => {
    const { repo } = makeRepo(
      routed({
        'GET /git/ref/heads/main': () => json({ message: 'Not Found' }, { status: 404 }),
      }),
    )
    expect(await repo.readHead()).toEqual({
      commitSha: '',
      tree: { entries: [], truncated: false, commitSha: '' },
    })
  })
})

describe('커밋', () => {
  it('blob → tree → commit → ref 순서로 한 커밋을 만든다', async () => {
    const { repo, calls } = makeRepo(routed(fullCommitRoutes('tree-0', 'c2')))

    const sha = await repo.commit({
      message: '기록 저장',
      put: [FILE],
      baseCommitSha: 'c1',
    })

    expect(sha).toBe('c2')
    expect(trace(calls)).toEqual([
      'GET /git/commits/c1',
      'POST /git/blobs',
      'POST /git/trees',
      'POST /git/commits',
      'PATCH /git/refs/heads/main',
    ])
    expect(calls.filter((c) => c.method !== 'GET').map((c) => api(c.url))).toEqual([
      '/git/blobs',
      '/git/trees',
      '/git/commits',
      '/git/refs/heads/main',
    ])
    expect(calls[2]!.body.base_tree).toBe('tree-0')
    expect(calls[2]!.body.tree).toEqual([
      { path: 'data/records.bin', mode: '100644', type: 'blob', sha: 'blob-1' },
    ])
    expect(calls[3]!.body.parents).toEqual(['c1'])
    expect(calls[4]!.body).toEqual({ sha: 'c2', force: false })
  })

  it('ref 갱신이 거부되면 커밋 sha를 돌려주지 않는다', async () => {
    const { repo } = makeRepo(
      routed({
        ...fullCommitRoutes('tree-0', 'c2'),
        'PATCH /git/refs/heads/main': () =>
          json({ message: 'Update is not a fast forward' }, { status: 422 }),
      }),
    )

    const result = await repo
      .commit({ message: '기록 저장', put: [FILE], baseCommitSha: 'c1' })
      .then((sha) => ({ sha }))
      .catch((err: unknown) => ({ err }))

    expect(result).not.toHaveProperty('sha')
    expect((result as { err: unknown }).err).toBeInstanceOf(ConflictError)
  })

  it('올릴 파일이 없으면 요청을 한 건도 보내지 않는다', async () => {
    const { repo, calls } = makeRepo(
      routed({}),
    )
    expect(await repo.commit({ message: '변화 없음', put: [], baseCommitSha: 'c7' })).toBe(
      'c7',
    )
    expect(calls).toHaveLength(0)
  })

  it('커밋이 하나도 없는 브랜치에는 부모 없이 최초 커밋을 만든다', async () => {
    const { repo, calls } = makeRepo(
      routed({
        'GET /git/ref/heads/main': () => json({ message: 'Not Found' }, { status: 404 }),
        'POST /git/blobs': () => json({ sha: 'blob-1' }),
        'POST /git/trees': () => json({ sha: 'tree-1' }),
        'POST /git/commits': () => json({ sha: 'c1' }),
        'POST /git/refs': () => json({ object: { sha: 'c1' } }),
      }),
    )

    expect(await repo.commit({ message: '첫 커밋', put: [FILE] })).toBe('c1')
    expect(trace(calls)).toEqual([
      'GET /git/ref/heads/main',
      'POST /git/blobs',
      'POST /git/trees',
      'POST /git/commits',
      'POST /git/refs',
    ])
    expect(calls[2]!.body.base_tree).toBeUndefined()
    expect(calls[3]!.body.parents).toEqual([])
    expect(calls[4]!.body).toEqual({ ref: 'refs/heads/main', sha: 'c1' })
  })
})

describe('경합하는 커밋', () => {
  it('앞질러 간 브랜치를 다시 읽어 트리를 재구성하고 재시도한다', async () => {
    let refReads = 0
    let patches = 0
    const { repo } = makeRepo(
      routed({
        'GET /git/ref/heads/main': () => {
          refReads++
          return json({ object: { sha: refReads === 1 ? 'c1' : 'c9' } })
        },
        'GET /git/trees/c1': () =>
          json({ tree: [{ path: 'old.bin', sha: 'sha-old', size: 1, type: 'blob' }] }),
        'GET /git/trees/c9': () =>
          json({ tree: [{ path: 'new.bin', sha: 'sha-new', size: 2, type: 'blob' }] }),
        'GET /git/commits/c1': () => json({ sha: 'c1', tree: { sha: 'tree-1' } }),
        'GET /git/commits/c9': () => json({ sha: 'c9', tree: { sha: 'tree-9' } }),
        'POST /git/blobs': () => json({ sha: 'blob-1' }),
        'POST /git/trees': () => json({ sha: 'tree-new' }),
        'POST /git/commits': () => json({ sha: patches === 0 ? 'c2' : 'c10' }),
        'PATCH /git/refs/heads/main': () => {
          patches++
          return patches === 1
            ? json({ message: 'Update is not a fast forward' }, { status: 422 })
            : json({ object: { sha: 'c10' } })
        },
      }),
    )

    const seen: RemoteHead[] = []
    const build = vi.fn(async (head: RemoteHead): Promise<CommitPlan> => {
      seen.push(head)
      return { message: '재구성', put: [FILE] }
    })

    expect(await repo.commitWithRetry(build)).toBe('c10')
    expect(build).toHaveBeenCalledTimes(2)
    expect(seen.map((h) => h.commitSha)).toEqual(['c1', 'c9'])
    expect(seen[0]!.tree.entries.map((e) => e.path)).toEqual(['old.bin'])
    expect(seen[1]!.tree.entries.map((e) => e.path)).toEqual(['new.bin'])
  })

  it('올릴 것이 없다고 하면 커밋하지 않는다', async () => {
    const { repo, calls } = makeRepo(
      routed({
        'GET /git/ref/heads/main': () => json({ object: { sha: 'c1' } }),
        'GET /git/trees/c1': () => json({ tree: [] }),
      }),
    )

    const build = vi.fn(async () => null)
    expect(await repo.commitWithRetry(build)).toBe('c1')
    expect(build).toHaveBeenCalledTimes(1)
    expect(trace(calls)).toEqual([
      'GET /git/ref/heads/main',
      'GET /git/trees/c1?recursive=1',
    ])
  })
})

describe('재시도와 대기', () => {
  it('요청 한도에 걸리면 간격을 늘려가며 다시 시도한다', async () => {
    let hits = 0
    const { repo, sleeps, calls } = makeRepo(
      routed({
        'GET /git/trees/main': () => {
          hits++
          return hits <= 2
            ? json({ message: 'Too many requests' }, { status: 429 })
            : json({ tree: [] })
        },
      }),
    )

    await repo.readTree()
    expect(calls).toHaveLength(3)
    expect(sleeps).toHaveLength(2)
    expect(sleeps[1]!).toBeGreaterThan(sleeps[0]!)
  })

  it('서버 오류도 백오프로 다시 시도한다', async () => {
    let hits = 0
    const { repo, sleeps } = makeRepo(
      routed({
        'GET /git/trees/main': () => {
          hits++
          return hits <= 2
            ? json({ message: 'Server Error' }, { status: 502 })
            : json({ tree: [] })
        },
      }),
    )

    await repo.readTree()
    expect(sleeps).toHaveLength(2)
    expect(sleeps[1]!).toBeGreaterThan(sleeps[0]!)
  })

  it('Retry-After 헤더가 있으면 그 값을 따른다', async () => {
    let hits = 0
    const { repo, sleeps } = makeRepo(
      routed({
        'GET /git/trees/main': () => {
          hits++
          return hits === 1
            ? json({ message: 'slow down' }, { status: 429, headers: { 'retry-after': '7' } })
            : json({ tree: [] })
        },
      }),
    )

    await repo.readTree()
    expect(sleeps).toEqual([7000])
  })

  it('부차 한도로 막힌 403은 다시 시도하고 끝내 한도 오류를 던진다', async () => {
    const { repo, calls } = makeRepo(
      routed({
        'GET /git/trees/main': () =>
          json(
            { message: 'You have exceeded a secondary rate limit' },
            { status: 403, headers: { 'x-ratelimit-remaining': '4321' } },
          ),
      }),
      2,
    )

    await expect(repo.readTree()).rejects.toBeInstanceOf(RateLimitError)
    expect(calls).toHaveLength(2)
  })

  it('인증 실패는 재시도 없이 즉시 알린다', async () => {
    const { repo, calls, sleeps } = makeRepo(
      routed({
        'GET /git/trees/main': () => json({ message: 'Bad credentials' }, { status: 401 }),
      }),
    )

    await expect(repo.readTree()).rejects.toBeInstanceOf(AuthError)
    expect(calls).toHaveLength(1)
    expect(sleeps).toEqual([])
  })

  it('권한이 없는 403도 재시도하지 않는다', async () => {
    const { repo, calls } = makeRepo(
      routed({
        'GET /git/trees/main': () =>
          json(
            { message: 'Resource not accessible by personal access token' },
            { status: 403, headers: { 'x-ratelimit-remaining': '4999' } },
          ),
      }),
    )

    await expect(repo.readTree()).rejects.toBeInstanceOf(AuthError)
    expect(calls).toHaveLength(1)
  })
})

describe('토큰 가리기', () => {
  it('오류 어디에도 토큰이 남지 않는다', async () => {
    const { repo, calls } = makeRepo(
      routed({
        'GET /git/trees/main': () =>
          json({ message: `Bad credentials: Bearer ${TOKEN}` }, { status: 401 }),
      }),
    )

    const err = await repo.readTree().then(
      () => null,
      (caught: unknown) => caught,
    )

    expect(err).toBeInstanceOf(AuthError)
    const shown = `${String((err as Error).message)}\n${String(err)}\n${(err as Error).stack ?? ''}\n${JSON.stringify(err, Object.getOwnPropertyNames(err))}`
    expect(shown).not.toContain(TOKEN)
    expect(shown).toContain(REDACTED)
    expect(calls.every((c) => !c.url.includes(TOKEN))).toBe(true)
  })

  it('토큰은 헤더로만 나가고 주소에는 실리지 않는다', async () => {
    const { repo, calls } = makeRepo(
      routed({
        'GET /git/trees/main': () => json({ tree: [] }),
      }),
    )

    await repo.readTree()
    expect(calls[0]!.headers['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect(calls[0]!.headers['Accept']).toBe('application/vnd.github+json')
    expect(calls[0]!.headers['X-GitHub-Api-Version']).toBe('2022-11-28')
    expect(calls[0]!.url).not.toContain(TOKEN)
    expect(calls[0]!.url.includes('?')).toBe(true)
    expect(calls[0]!.url.split('?')[1]).toBe('recursive=1')
  })

  it('여러 형태로 섞인 토큰을 모두 지운다', () => {
    const text = `앞 ${TOKEN} 가운데 ${encodeURIComponent(TOKEN)} 뒤 ${btoa(TOKEN)}`
    const scrubbed = scrubToken(text, TOKEN)
    expect(scrubbed).not.toContain(TOKEN)
    expect(scrubbed).not.toContain(btoa(TOKEN))
    expect(scrubbed).toContain('앞')
  })

  it('짧은 문자열까지 지우려 들지는 않는다', () => {
    expect(scrubToken('안녕하세요', 'ab')).toBe('안녕하세요')
  })
})

describe('blob 왕복', () => {
  const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 37) % 256)

  it('base64로 보내고 같은 바이트로 되받는다', async () => {
    let sent = ''
    const { repo } = makeRepo(
      routed({
        'GET /git/commits/c1': () => json({ sha: 'c1', tree: { sha: 'tree-0' } }),
        'POST /git/blobs': (body) => {
          sent = String(body.content)
          expect(body.encoding).toBe('base64')
          return json({ sha: 'blob-1' })
        },
        'POST /git/trees': () => json({ sha: 'tree-1' }),
        'POST /git/commits': () => json({ sha: 'c2' }),
        'PATCH /git/refs/heads/main': () => json({ object: { sha: 'c2' } }),
        'GET /git/blobs/blob-1': () =>
          json({ content: wrap(sent), encoding: 'base64', size: bytes.length }),
      }),
    )

    await repo.commit({
      message: '바이트 저장',
      put: [{ path: 'data/blob.bin', content: bytes }],
      baseCommitSha: 'c1',
    })

    expect(sent).toBe(toBase64(bytes))
    expect(Array.from(await repo.readBlob('blob-1'))).toEqual(Array.from(bytes))
  })

  it('base64가 아닌 인코딩은 거부한다', async () => {
    const { repo } = makeRepo(
      routed({
        'GET /git/blobs/blob-9': () => json({ content: 'x', encoding: 'none' }),
      }),
    )
    await expect(repo.readBlob('blob-9')).rejects.toBeInstanceOf(RemoteError)
  })
})

describe('평문 파일 읽기', () => {
  it('없으면 null을 돌려준다', async () => {
    const { repo } = makeRepo(
      routed({
        'GET /contents/meta.json': () => json({ message: 'Not Found' }, { status: 404 }),
      }),
    )
    expect(await repo.readTextFile('meta.json')).toBeNull()
  })

  it('base64 내용을 문자열로 되돌린다', async () => {
    const text = '{"봉투":"열림"}'
    const { repo, calls } = makeRepo(
      routed({
        'GET /contents/meta/envelope.json': () =>
          json({
            content: wrap(toBase64(new TextEncoder().encode(text))),
            encoding: 'base64',
          }),
      }),
    )

    expect(await repo.readTextFile('meta/envelope.json')).toBe(text)
    expect(api(calls[0]!.url)).toBe('/contents/meta/envelope.json?ref=main')
  })
})

describe('내려받은 바이트', () => {
  it('base64 디코더가 원본 길이를 지킨다', () => {
    const bytes = Uint8Array.from({ length: 17 }, (_, i) => i * 3)
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes))
  })
})

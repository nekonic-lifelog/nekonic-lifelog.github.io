import { fromBase64, toBase64 } from '../crypto/kdf'
import { scrubToken, scrubbedMessage } from './tokenScrub'
import {
  AuthError,
  ConflictError,
  NotFoundError,
  RateLimitError,
  RemoteError,
} from './types'
import type {
  CommitBuilder,
  CommitInput,
  RemoteHead,
  RepoRef,
  TreeIndex,
} from './types'

const API = 'https://api.github.com'
const API_VERSION = '2022-11-28'
const ACCEPT = 'application/vnd.github+json'
const BLOB_MODE = '100644'
const DEFAULT_MAX_ATTEMPTS = 5
const BASE_DELAY = 500
const MAX_DELAY = 30_000
const DETAIL_LIMIT = 200

export interface GithubRepoOptions {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxAttempts?: number
}

interface SendOptions {
  method?: string
  body?: unknown
  conflict?: boolean
}

interface Failure {
  error: RemoteError
  retry: boolean
  delayMs: number | null
}

interface RawTreeEntry {
  path?: unknown
  sha?: unknown
  size?: unknown
  type?: unknown
}

interface RawTree {
  truncated?: unknown
  tree?: RawTreeEntry[]
}

interface RawSha {
  sha?: unknown
}

interface RawCommit {
  sha?: unknown
  tree?: RawSha
}

interface RawRef {
  object?: RawSha
}

interface RawBlob {
  content?: unknown
  encoding?: unknown
}

function encodePath(value: string): string {
  return value
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function backoff(attempt: number): number {
  return Math.min(MAX_DELAY, BASE_DELAY * 2 ** (attempt - 1))
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const at = Date.parse(header)
  if (Number.isNaN(at)) return null
  return Math.max(0, at - Date.now())
}

function isSecondaryLimit(body: string, res: Response): boolean {
  if (res.headers.get('retry-after') !== null) return true
  if (res.headers.get('x-ratelimit-remaining') === '0') return true
  return /secondary rate limit|abuse detection/i.test(body)
}

function isNotFastForward(body: string): boolean {
  return /fast forward|fast-forward/i.test(body)
}

function detailOf(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object') {
      const message = (parsed as { message?: unknown }).message
      if (typeof message === 'string') return message
    }
  } catch {
    void 0
  }
  return body.slice(0, DETAIL_LIMIT)
}

function stripWhitespace(text: string): string {
  return text.replace(/\s+/g, '')
}

function readSha(value: RawSha | undefined, what: string): string {
  const sha = value?.sha
  if (typeof sha !== 'string' || sha.length === 0) {
    throw new RemoteError(`${what} 응답에 sha가 없습니다`)
  }
  return sha
}

export class GithubRepo {
  #ref: RepoRef
  #token: string
  #fetch: typeof fetch
  #sleep: (ms: number) => Promise<void>
  #maxAttempts: number

  constructor(ref: RepoRef, token: string, opts: GithubRepoOptions = {}) {
    this.#ref = ref
    this.#token = token
    this.#fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.#sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.#maxAttempts = Math.max(1, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  }

  get ref(): RepoRef {
    return { ...this.#ref }
  }

  async readTree(commitSha?: string): Promise<TreeIndex> {
    const target = commitSha && commitSha.length > 0 ? commitSha : this.#ref.branch
    const data = await this.#jsonOrNull<RawTree>(
      `/git/trees/${encodePath(target)}?recursive=1`,
    )
    if (!data) return { entries: [], truncated: false, commitSha: '' }
    const raw = Array.isArray(data.tree) ? data.tree : []
    const entries = raw
      .filter((entry) => entry.type === 'blob')
      .filter((entry) => typeof entry.path === 'string' && typeof entry.sha === 'string')
      .map((entry) => ({
        path: entry.path as string,
        sha: entry.sha as string,
        size: typeof entry.size === 'number' ? entry.size : 0,
      }))
    return {
      entries,
      truncated: data.truncated === true,
      commitSha: commitSha ?? '',
    }
  }

  async readHead(): Promise<RemoteHead> {
    const commitSha = await this.#refSha()
    if (!commitSha) {
      return { commitSha: '', tree: { entries: [], truncated: false, commitSha: '' } }
    }
    return { commitSha, tree: await this.readTree(commitSha) }
  }

  async readBlob(sha: string): Promise<Uint8Array> {
    const blob = await this.#json<RawBlob>(`/git/blobs/${encodeURIComponent(sha)}`)
    if (blob.encoding !== 'base64') {
      throw new RemoteError(`base64가 아닌 blob 인코딩입니다: ${String(blob.encoding)}`)
    }
    if (typeof blob.content !== 'string') {
      throw new RemoteError('blob 응답에 내용이 없습니다')
    }
    return fromBase64(stripWhitespace(blob.content))
  }

  async readTextFile(path: string): Promise<string | null> {
    const query = `?ref=${encodeURIComponent(this.#ref.branch)}`
    const data = await this.#jsonOrNull<RawBlob>(`/contents/${encodePath(path)}${query}`)
    if (!data) return null
    if (typeof data.content !== 'string') return null
    if (data.encoding !== 'base64') {
      throw new RemoteError(`base64가 아닌 파일 인코딩입니다: ${String(data.encoding)}`)
    }
    return new TextDecoder().decode(fromBase64(stripWhitespace(data.content)))
  }

  async commit(input: CommitInput): Promise<string> {
    if (input.put.length === 0) {
      if (input.baseCommitSha !== undefined) return input.baseCommitSha
      return await this.#refSha()
    }
    const parent = input.baseCommitSha ?? (await this.#refSha())
    const baseTree = parent ? await this.#treeShaOf(parent) : ''

    const tree: Array<{ path: string; mode: string; type: string; sha: string }> = []
    for (const file of input.put) {
      const blob = await this.#json<RawSha>('/git/blobs', {
        method: 'POST',
        body: { content: toBase64(file.content), encoding: 'base64' },
      })
      tree.push({
        path: file.path,
        mode: BLOB_MODE,
        type: 'blob',
        sha: readSha(blob, 'blob'),
      })
    }

    const created = await this.#json<RawSha>('/git/trees', {
      method: 'POST',
      body: baseTree ? { base_tree: baseTree, tree } : { tree },
    })
    const commit = await this.#json<RawSha>('/git/commits', {
      method: 'POST',
      body: {
        message: input.message,
        tree: readSha(created, '트리'),
        parents: parent ? [parent] : [],
      },
    })
    const commitSha = readSha(commit, '커밋')

    if (parent) {
      await this.#json(`/git/refs/heads/${encodePath(this.#ref.branch)}`, {
        method: 'PATCH',
        body: { sha: commitSha, force: false },
        conflict: true,
      })
    } else {
      await this.#json('/git/refs', {
        method: 'POST',
        body: { ref: `refs/heads/${this.#ref.branch}`, sha: commitSha },
        conflict: true,
      })
    }
    return commitSha
  }

  async commitWithRetry(build: CommitBuilder): Promise<string> {
    let lastConflict: ConflictError | null = null
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt++) {
      const head = await this.readHead()
      const plan = await build(head)
      if (!plan) return head.commitSha
      try {
        return await this.commit({
          message: plan.message,
          put: plan.put,
          baseCommitSha: head.commitSha,
        })
      } catch (err) {
        if (!(err instanceof ConflictError)) throw err
        lastConflict = err
      }
    }
    throw lastConflict ?? new ConflictError()
  }

  async #refSha(): Promise<string> {
    const data = await this.#jsonOrNull<RawRef>(
      `/git/ref/heads/${encodePath(this.#ref.branch)}`,
    )
    const sha = data?.object?.sha
    return typeof sha === 'string' ? sha : ''
  }

  async #treeShaOf(commitSha: string): Promise<string> {
    const commit = await this.#json<RawCommit>(
      `/git/commits/${encodeURIComponent(commitSha)}`,
    )
    return readSha(commit.tree, '부모 커밋 트리')
  }

  #headers(hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#token}`,
      Accept: ACCEPT,
      'X-GitHub-Api-Version': API_VERSION,
    }
    if (hasBody) headers['Content-Type'] = 'application/json'
    return headers
  }

  #scrub(text: string): string {
    return scrubToken(text, this.#token)
  }

  async #jsonOrNull<T>(path: string, opts: SendOptions = {}): Promise<T | null> {
    try {
      return await this.#json<T>(path, opts)
    } catch (err) {
      if (err instanceof NotFoundError) return null
      throw err
    }
  }

  async #json<T>(path: string, opts: SendOptions = {}): Promise<T> {
    const res = await this.#send(path, opts)
    const text = await res.text()
    if (!text) return {} as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new RemoteError('원격 응답을 JSON으로 읽지 못했습니다')
    }
  }

  async #send(path: string, opts: SendOptions): Promise<Response> {
    const url = `${API}/repos/${encodeURIComponent(this.#ref.owner)}/${encodeURIComponent(this.#ref.repo)}${path}`
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers: this.#headers(opts.body !== undefined),
    }
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body)

    for (let attempt = 1; ; attempt++) {
      let res: Response
      try {
        res = await this.#fetch(url, init)
      } catch (err) {
        if (attempt >= this.#maxAttempts) {
          throw new RemoteError(
            `원격에 연결하지 못했습니다: ${scrubbedMessage(err, this.#token)}`,
          )
        }
        await this.#sleep(backoff(attempt))
        continue
      }
      if (res.ok) return res
      const failure = await this.#failure(res, opts)
      if (!failure.retry || attempt >= this.#maxAttempts) throw failure.error
      await this.#sleep(failure.delayMs ?? backoff(attempt))
    }
  }

  async #failure(res: Response, opts: SendOptions): Promise<Failure> {
    const body = await res.text().catch(() => '')
    const detail = this.#scrub(detailOf(body))
    const retryAfter = parseRetryAfter(res.headers.get('retry-after'))
    const status = res.status

    if (status === 401) {
      return {
        error: new AuthError(`인증에 실패했습니다: ${detail}`, status),
        retry: false,
        delayMs: null,
      }
    }
    if (status === 403) {
      if (isSecondaryLimit(body, res)) {
        return {
          error: new RateLimitError(
            `요청이 너무 잦아 잠시 막혔습니다: ${detail}`,
            status,
            retryAfter,
          ),
          retry: true,
          delayMs: retryAfter,
        }
      }
      return {
        error: new AuthError(`저장소에 접근할 권한이 없습니다: ${detail}`, status),
        retry: false,
        delayMs: null,
      }
    }
    if (status === 429) {
      return {
        error: new RateLimitError(`요청 한도를 넘었습니다: ${detail}`, status, retryAfter),
        retry: true,
        delayMs: retryAfter,
      }
    }
    if (status === 404) {
      return {
        error: new NotFoundError(`원격에서 찾을 수 없습니다: ${detail}`, status),
        retry: false,
        delayMs: null,
      }
    }
    if (opts.conflict && (status === 409 || status === 422 || isNotFastForward(body))) {
      return {
        error: new ConflictError(
          `브랜치가 그사이 갱신되어 반영하지 못했습니다: ${detail}`,
          status,
        ),
        retry: false,
        delayMs: null,
      }
    }
    if (status >= 500) {
      return {
        error: new RemoteError(`원격 서버 오류(${status}): ${detail}`, status),
        retry: true,
        delayMs: retryAfter,
      }
    }
    return {
      error: new RemoteError(`요청이 거부되었습니다(${status}): ${detail}`, status),
      retry: false,
      delayMs: null,
    }
  }
}

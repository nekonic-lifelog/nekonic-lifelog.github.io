export interface RepoRef {
  owner: string
  repo: string
  branch: string
}

export interface TreeEntry {
  path: string
  sha: string
  size: number
}

export interface TreeIndex {
  entries: TreeEntry[]
  truncated: boolean
  commitSha: string
}

export interface PutFile {
  path: string
  content: Uint8Array
}

export interface CommitInput {
  message: string
  put: PutFile[]
  baseCommitSha?: string
}

export interface CommitPlan {
  message: string
  put: PutFile[]
}

export interface RemoteHead {
  commitSha: string
  tree: TreeIndex
}

export type CommitBuilder = (head: RemoteHead) => Promise<CommitPlan | null>

export class RemoteError extends Error {
  readonly status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'RemoteError'
    this.status = status
  }
}

export class AuthError extends RemoteError {
  constructor(message = '토큰이 유효하지 않거나 권한이 부족합니다', status = 401) {
    super(message, status)
    this.name = 'AuthError'
  }
}

export class RateLimitError extends RemoteError {
  readonly retryAfterMs: number | null

  constructor(
    message = '요청 한도에 걸렸습니다. 잠시 후 다시 시도합니다',
    status = 429,
    retryAfterMs: number | null = null,
  ) {
    super(message, status)
    this.name = 'RateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}

export class ConflictError extends RemoteError {
  constructor(message = '다른 기기가 먼저 올려서 브랜치가 갱신되었습니다', status = 409) {
    super(message, status)
    this.name = 'ConflictError'
  }
}

export class NotFoundError extends RemoteError {
  constructor(message = '원격에서 대상을 찾을 수 없습니다', status = 404) {
    super(message, status)
    this.name = 'NotFoundError'
  }
}

import { fromBase64, toBase64 } from '../crypto/kdf'

export const LINK_VERSION = 1

const MAGIC = 'LLNK'
const SEP = String.fromCharCode(31)
const FIELDS = 8
const KEY_BYTES = 32
const SUM_CHARS = 6

export interface LinkPayload {
  v: number
  key: string
  token: string
  deviceId: string
  repo: { owner: string; repo: string; branch: string }
}

export class LinkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LinkError'
  }
}

function checksum(body: string): string {
  let h = 0x811c9dc5
  for (const b of new TextEncoder().encode(body)) {
    h ^= b
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return (h >>> 8).toString(16).padStart(SUM_CHARS, '0')
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const rest = text.length % 4
  const pad = rest === 0 ? '' : '='.repeat(4 - rest)
  return fromBase64(text.replace(/-/g, '+').replace(/_/g, '/') + pad)
}

function requireField(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LinkError(`연결 코드에 ${name}이(가) 없습니다.`)
  }
  if (value.includes(SEP)) {
    throw new LinkError(`${name}에 쓸 수 없는 문자가 들어 있습니다.`)
  }
  return value
}

export function encodeLinkPayload(p: LinkPayload): string {
  if (!Number.isInteger(p.v) || p.v < 1) {
    throw new LinkError('연결 코드 버전이 올바르지 않습니다.')
  }
  let raw: Uint8Array
  try {
    raw = fromBase64(requireField(p.key, '데이터 키'))
  } catch (err) {
    if (err instanceof LinkError) throw err
    throw new LinkError('데이터 키를 읽을 수 없습니다.')
  }
  if (raw.length !== KEY_BYTES) {
    throw new LinkError('데이터 키 길이가 올바르지 않습니다.')
  }
  const body = [
    String(p.v),
    toBase64Url(raw),
    requireField(p.token, '토큰'),
    requireField(p.deviceId, '기기 ID'),
    requireField(p.repo?.owner, '소유자'),
    requireField(p.repo?.repo, '레포 이름'),
    requireField(p.repo?.branch, '브랜치'),
  ].join(SEP)
  return `${MAGIC}${SEP}${body}${SEP}${checksum(body)}`
}

export function decodeLinkPayload(text: string): LinkPayload {
  if (typeof text !== 'string' || !text.startsWith(`${MAGIC}${SEP}`)) {
    throw new LinkError('기기 연결 코드가 아닙니다. 다른 기기의 연결 화면에 뜬 QR을 읽으세요.')
  }
  const parts = text.slice(MAGIC.length + SEP.length).split(SEP)
  if (parts.length !== FIELDS) {
    throw new LinkError('연결 코드가 잘렸습니다. QR 전체가 화면에 다 보이게 하고 다시 읽으세요.')
  }
  const [
    vRaw = '',
    key = '',
    token = '',
    deviceId = '',
    owner = '',
    repo = '',
    branch = '',
    sum = '',
  ] = parts
  const body = parts.slice(0, FIELDS - 1).join(SEP)
  if (sum !== checksum(body)) {
    throw new LinkError('연결 코드가 손상되었습니다. 보내는 기기에서 QR을 다시 띄우고 읽으세요.')
  }

  const v = Number(vRaw)
  if (!Number.isInteger(v) || v < 1) {
    throw new LinkError('연결 코드 버전을 읽을 수 없습니다.')
  }
  if (v > LINK_VERSION) {
    throw new LinkError(
      `이 연결 코드는 v${v}입니다. 이 기기의 앱을 최신 버전으로 갱신한 뒤 다시 읽으세요.`,
    )
  }

  let raw: Uint8Array
  try {
    raw = fromBase64Url(key)
  } catch {
    throw new LinkError('연결 코드의 데이터 키를 읽을 수 없습니다.')
  }
  if (raw.length !== KEY_BYTES) {
    throw new LinkError('연결 코드의 데이터 키 길이가 올바르지 않습니다.')
  }

  return {
    v,
    key: toBase64(raw),
    token: requireField(token, '토큰'),
    deviceId: requireField(deviceId, '기기 ID'),
    repo: {
      owner: requireField(owner, '소유자'),
      repo: requireField(repo, '레포 이름'),
      branch: requireField(branch, '브랜치'),
    },
  }
}

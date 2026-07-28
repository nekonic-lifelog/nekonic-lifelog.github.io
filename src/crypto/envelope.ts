import { importDataKey } from './cipher'
import {
  deriveMasterKey,
  fromBase64,
  newKdfParams,
  randomBytes,
  toBase64,
  type KdfName,
  type KdfParams,
} from './kdf'

export const ENVELOPE_VERSION = 1

export interface PassphraseWrap {
  type: 'passphrase'
  label?: string
  params: KdfParams
  nonce: string
  ct: string
}

export interface Envelope {
  v: number
  wraps: PassphraseWrap[]
}

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvelopeError'
  }
}

async function wrapRawKey(
  raw: Uint8Array,
  passphrase: string,
  params: KdfParams,
  label?: string,
): Promise<PassphraseWrap> {
  const master = await deriveMasterKey(passphrase, params)
  const nonce = randomBytes(12)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, master, new Uint8Array(raw)),
  )
  const wrap: PassphraseWrap = {
    type: 'passphrase',
    params,
    nonce: toBase64(nonce),
    ct: toBase64(ct),
  }
  if (label !== undefined) wrap.label = label
  return wrap
}

async function unwrapWith(
  wrap: PassphraseWrap,
  passphrase: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const master = await deriveMasterKey(passphrase, wrap.params)
    const raw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(fromBase64(wrap.nonce)) },
      master,
      new Uint8Array(fromBase64(wrap.ct)),
    )
    return new Uint8Array(raw)
  } catch {
    return null
  }
}

export interface OpenedEnvelope {
  envelope: Envelope
  /** 암·복호화에 쓰는 핸들. 꺼낼 수 없다 */
  dataKey: CryptoKey
  /** 기기 연결용. 필요할 때만 들고 있는다 */
  raw: Uint8Array<ArrayBuffer>
}

export async function createEnvelope(
  passphrase: string,
  kdf: KdfName = 'argon2id',
): Promise<OpenedEnvelope> {
  const raw = randomBytes(32)
  const wrap = await wrapRawKey(raw, passphrase, newKdfParams(kdf))
  return {
    envelope: { v: ENVELOPE_VERSION, wraps: [wrap] },
    dataKey: await importDataKey(raw),
    raw,
  }
}

export async function openEnvelope(
  envelope: Envelope,
  passphrase: string,
): Promise<OpenedEnvelope> {
  if (envelope.v > ENVELOPE_VERSION) {
    throw new EnvelopeError(
      `이 봉투는 v${envelope.v}입니다. 앱을 최신 버전으로 갱신한 뒤 다시 시도하세요.`,
    )
  }
  for (const wrap of envelope.wraps) {
    const raw = await unwrapWith(wrap, passphrase)
    if (raw) return { envelope, dataKey: await importDataKey(raw), raw }
  }
  throw new EnvelopeError('암호구절이 맞지 않습니다.')
}

/**
 * 새 항목을 먼저 더하고, 확인한 뒤에 옛 항목을 지운다.
 * 중간에 실패해도 잠기지 않는다.
 */
export async function addPassphrase(
  envelope: Envelope,
  raw: Uint8Array,
  passphrase: string,
  kdf: KdfName = 'argon2id',
  label?: string,
): Promise<Envelope> {
  const wrap = await wrapRawKey(raw, passphrase, newKdfParams(kdf), label)
  return { ...envelope, wraps: [...envelope.wraps, wrap] }
}

export function removeWrapAt(envelope: Envelope, index: number): Envelope {
  if (envelope.wraps.length <= 1) {
    throw new EnvelopeError('마지막 남은 항목은 지울 수 없습니다. 지우면 열 수 없게 됩니다.')
  }
  return { ...envelope, wraps: envelope.wraps.filter((_, i) => i !== index) }
}

export function parseEnvelope(text: string): Envelope {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new EnvelopeError('봉투를 JSON으로 읽을 수 없습니다.')
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new EnvelopeError('봉투의 최상위가 객체가 아닙니다.')
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj['v'] !== 'number') throw new EnvelopeError('봉투에 버전이 없습니다.')
  if (!Array.isArray(obj['wraps']) || obj['wraps'].length === 0) {
    throw new EnvelopeError('봉투에 항목이 없습니다.')
  }
  return { v: obj['v'], wraps: obj['wraps'] as PassphraseWrap[] }
}

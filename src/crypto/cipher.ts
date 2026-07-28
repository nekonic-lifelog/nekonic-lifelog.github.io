import { randomBytes } from './kdf'

const FORMAT = 1
const FLAG_GZIP = 1
const NONCE_BYTES = 12
const HEADER = 2

export function supportsCompression(): boolean {
  return typeof CompressionStream !== 'undefined'
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function importDataKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new Uint8Array(raw), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

export async function generateDataKeyBytes(): Promise<Uint8Array<ArrayBuffer>> {
  return randomBytes(32)
}

export async function seal(key: CryptoKey, plain: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  let body = plain
  let flags = 0
  if (supportsCompression()) {
    body = await gzip(plain)
    flags |= FLAG_GZIP
  }
  const nonce = randomBytes(NONCE_BYTES)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new Uint8Array(body)),
  )

  const out = new Uint8Array(HEADER + NONCE_BYTES + ct.length)
  out[0] = FORMAT
  out[1] = flags
  out.set(nonce, HEADER)
  out.set(ct, HEADER + NONCE_BYTES)
  return out
}

export async function open(key: CryptoKey, blob: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  if (blob.length < HEADER + NONCE_BYTES) throw new Error('암호문이 너무 짧습니다')
  if (blob[0] !== FORMAT) throw new Error(`알 수 없는 암호문 형식: ${blob[0]}`)
  const flags = blob[1]!
  const nonce = blob.slice(HEADER, HEADER + NONCE_BYTES)
  const ct = blob.slice(HEADER + NONCE_BYTES)

  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct),
  )
  if ((flags & FLAG_GZIP) === 0) return plain
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('압축된 데이터인데 이 브라우저는 DecompressionStream이 없습니다')
  }
  return gunzip(plain)
}

export async function sealJson(key: CryptoKey, value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  return seal(key, new TextEncoder().encode(JSON.stringify(value)))
}

export async function openJson<T>(key: CryptoKey, blob: Uint8Array): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await open(key, blob))) as T
}

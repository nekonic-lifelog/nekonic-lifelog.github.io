export type KdfName = 'argon2id' | 'pbkdf2'

export interface KdfParams {
  kdf: KdfName
  salt: string
  memorySize?: number
  iterations: number
  parallelism?: number
}

export const ARGON2_DEFAULTS = {
  memorySize: 65536,
  iterations: 3,
  parallelism: 1,
} as const

export const PBKDF2_DEFAULTS = {
  iterations: 600_000,
} as const

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

export function newKdfParams(kdf: KdfName): KdfParams {
  const salt = toBase64(randomBytes(16))
  return kdf === 'argon2id'
    ? { kdf, salt, ...ARGON2_DEFAULTS }
    : { kdf, salt, iterations: PBKDF2_DEFAULTS.iterations }
}

async function argon2Bits(passphrase: string, params: KdfParams): Promise<Uint8Array> {
  const { argon2id } = await import('hash-wasm')
  const raw = await argon2id({
    password: passphrase,
    salt: fromBase64(params.salt),
    parallelism: params.parallelism ?? ARGON2_DEFAULTS.parallelism,
    iterations: params.iterations,
    memorySize: params.memorySize ?? ARGON2_DEFAULTS.memorySize,
    hashLength: 32,
    outputType: 'binary',
  })
  return new Uint8Array(raw)
}

async function pbkdf2Bits(passphrase: string, params: KdfParams): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new Uint8Array(fromBase64(params.salt)),
      iterations: params.iterations,
    },
    base,
    256,
  )
  return new Uint8Array(bits)
}

export async function deriveMasterKey(
  passphrase: string,
  params: KdfParams,
): Promise<CryptoKey> {
  const bits = params.kdf === 'argon2id'
    ? await argon2Bits(passphrase, params)
    : await pbkdf2Bits(passphrase, params)
  return crypto.subtle.importKey('raw', new Uint8Array(bits), 'AES-GCM', false, [
    'wrapKey',
    'unwrapKey',
    'encrypt',
    'decrypt',
  ])
}

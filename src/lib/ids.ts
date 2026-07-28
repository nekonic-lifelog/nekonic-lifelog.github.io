interface MaybeCrypto {
  randomUUID?: () => string
  getRandomValues<T extends ArrayBufferView>(array: T): T
}

export function newId(): string {
  const c = globalThis.crypto as unknown as MaybeCrypto | undefined
  if (!c) throw new Error('crypto를 쓸 수 없는 환경입니다')
  if (typeof c.randomUUID === 'function') return c.randomUUID()

  const bytes = new Uint8Array(16)
  c.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

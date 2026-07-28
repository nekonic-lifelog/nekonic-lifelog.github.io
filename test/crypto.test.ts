import { describe, expect, it } from 'vitest'
import {
  generateDataKeyBytes,
  importDataKey,
  open,
  openJson,
  seal,
  sealJson,
  supportsCompression,
} from '../src/crypto/cipher'
import {
  EnvelopeError,
  addPassphrase,
  createEnvelope,
  openEnvelope,
  parseEnvelope,
  removeWrapAt,
} from '../src/crypto/envelope'
import { deriveMasterKey, newKdfParams, toBase64 } from '../src/crypto/kdf'

const PASS = 'correct horse battery staple 열두글자'
const FAST = { ...newKdfParams('pbkdf2'), iterations: 1_000 }

async function fastEnvelope(passphrase = PASS) {
  const opened = await createEnvelope(passphrase, 'pbkdf2')
  return opened
}

describe('대칭 암호', () => {
  it('평문을 넣으면 그대로 돌아온다', async () => {
    const key = await importDataKey(await generateDataKeyBytes())
    const plain = new TextEncoder().encode('아침 약 먹기')
    expect(new TextDecoder().decode(await open(key, await seal(key, plain)))).toBe(
      '아침 약 먹기',
    )
  })

  it('JSON도 왕복한다', async () => {
    const key = await importDataKey(await generateDataKeyBytes())
    const value = { id: 'a', at: '2026-03-12T09:00:00Z', value: 700, nested: [1, 2, 3] }
    expect(await openJson(key, await sealJson(key, value))).toEqual(value)
  })

  it('매번 다른 논스를 쓴다 — 같은 평문이라도 암호문이 달라야 한다', async () => {
    const key = await importDataKey(await generateDataKeyBytes())
    const plain = new TextEncoder().encode('같은 내용')
    const a = await seal(key, plain)
    const b = await seal(key, plain)
    expect(toBase64(a)).not.toBe(toBase64(b))
  })

  it('다른 키로는 열리지 않는다', async () => {
    const a = await importDataKey(await generateDataKeyBytes())
    const b = await importDataKey(await generateDataKeyBytes())
    const blob = await seal(a, new TextEncoder().encode('비밀'))
    await expect(open(b, blob)).rejects.toThrow()
  })

  it('한 바이트만 건드려도 열리지 않는다', async () => {
    const key = await importDataKey(await generateDataKeyBytes())
    const blob = await seal(key, new TextEncoder().encode('비밀'))
    blob[blob.length - 1] = (blob[blob.length - 1] ?? 0) ^ 0xff
    await expect(open(key, blob)).rejects.toThrow()
  })

  it('알 수 없는 형식은 거부한다', async () => {
    const key = await importDataKey(await generateDataKeyBytes())
    const blob = await seal(key, new TextEncoder().encode('비밀'))
    blob[0] = 9
    await expect(open(key, blob)).rejects.toThrow(/형식/)
  })

  it('반복이 많은 데이터는 눈에 띄게 줄어든다', async () => {
    if (!supportsCompression()) return
    const key = await importDataKey(await generateDataKeyBytes())
    const rows = Array.from({ length: 300 }, (_, i) => ({
      id: `record-${i}`,
      defId: 'definition-0001',
      at: '2026-07-27T09:00:00.000Z',
      value: 1,
    }))
    const raw = new TextEncoder().encode(JSON.stringify(rows))
    const blob = await sealJson(key, rows)
    expect(blob.length).toBeLessThan(raw.length / 3)
    expect(await openJson(key, blob)).toEqual(rows)
  })
})

describe('봉투', () => {
  it('만들고 같은 암호구절로 다시 연다', async () => {
    const { envelope, raw } = await fastEnvelope()
    const reopened = await openEnvelope(envelope, PASS)
    expect(toBase64(reopened.raw)).toBe(toBase64(raw))
  })

  it('데이터키는 꺼낼 수 없는 형태다', async () => {
    const { dataKey } = await fastEnvelope()
    expect(dataKey.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', dataKey)).rejects.toThrow()
  })

  it('봉투로 감싼 키가 실제 데이터를 열 수 있다', async () => {
    const { envelope, dataKey } = await fastEnvelope()
    const blob = await sealJson(dataKey, { hello: '기록' })
    const again = await openEnvelope(envelope, PASS)
    expect(await openJson(again.dataKey, blob)).toEqual({ hello: '기록' })
  })

  it('틀린 암호구절은 거부한다', async () => {
    const { envelope } = await fastEnvelope()
    await expect(openEnvelope(envelope, '틀린 암호구절')).rejects.toThrow(EnvelopeError)
  })

  it('봉투 자체에는 키가 들어 있지 않다', async () => {
    const { envelope, raw } = await fastEnvelope()
    expect(JSON.stringify(envelope)).not.toContain(toBase64(raw))
  })

  it('앞으로 나올 버전은 거부한다', async () => {
    const { envelope } = await fastEnvelope()
    await expect(openEnvelope({ ...envelope, v: 99 }, PASS)).rejects.toThrow(/최신 버전/)
  })
})

describe('암호구절 변경 — 새 항목을 먼저 더한다', () => {
  it('두 암호구절이 같은 데이터를 연다', async () => {
    const { envelope, raw, dataKey } = await fastEnvelope()
    const blob = await sealJson(dataKey, { v: 1 })

    const two = await addPassphrase(envelope, raw, '새 암호구절입니다', 'pbkdf2')
    expect(two.wraps).toHaveLength(2)

    for (const pass of [PASS, '새 암호구절입니다']) {
      const opened = await openEnvelope(two, pass)
      expect(await openJson(opened.dataKey, blob)).toEqual({ v: 1 })
    }
  })

  it('옛 항목을 지우면 그 암호구절로는 못 연다', async () => {
    const { envelope, raw } = await fastEnvelope()
    const two = await addPassphrase(envelope, raw, '새 암호구절입니다', 'pbkdf2')
    const only = removeWrapAt(two, 0)

    await expect(openEnvelope(only, PASS)).rejects.toThrow(EnvelopeError)
    await expect(openEnvelope(only, '새 암호구절입니다')).resolves.toBeTruthy()
  })

  it('마지막 항목은 지울 수 없다 — 지우면 영구히 잠긴다', async () => {
    const { envelope } = await fastEnvelope()
    expect(() => removeWrapAt(envelope, 0)).toThrow(/지울 수 없습니다/)
  })

  it('데이터를 다시 암호화하지 않아도 된다', async () => {
    const { envelope, raw, dataKey } = await fastEnvelope()
    const before = await sealJson(dataKey, { 기록: '그대로' })
    const two = await addPassphrase(envelope, raw, '새 암호구절입니다', 'pbkdf2')
    const opened = await openEnvelope(two, '새 암호구절입니다')
    expect(await openJson(opened.dataKey, before)).toEqual({ 기록: '그대로' })
  })
})

describe('봉투 파싱', () => {
  it('JSON이 아니면 거부한다', () => {
    expect(() => parseEnvelope('nope')).toThrow(/JSON/)
  })
  it('항목이 비면 거부한다', () => {
    expect(() => parseEnvelope('{"v":1,"wraps":[]}')).toThrow(/항목이 없습니다/)
  })
  it('버전이 없으면 거부한다', () => {
    expect(() => parseEnvelope('{"wraps":[{}]}')).toThrow(/버전이 없습니다/)
  })
})

describe('키 유도', () => {
  it('같은 암호구절과 소금이면 같은 키가 나온다', async () => {
    const a = await deriveMasterKey(PASS, FAST)
    const b = await deriveMasterKey(PASS, FAST)
    const nonce = new Uint8Array(12)
    const plain = new TextEncoder().encode('확인')
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, a, plain)
    const back = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, b, ct)
    expect(new TextDecoder().decode(back)).toBe('확인')
  })

  it('소금이 다르면 다른 키가 나온다', async () => {
    const a = await deriveMasterKey(PASS, { ...FAST, salt: toBase64(new Uint8Array(16)) })
    const b = await deriveMasterKey(PASS, {
      ...FAST,
      salt: toBase64(new Uint8Array(16).fill(1)),
    })
    const nonce = new Uint8Array(12)
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      a,
      new TextEncoder().encode('확인'),
    )
    await expect(
      crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, b, ct),
    ).rejects.toThrow()
  })

  it('Argon2id도 왕복한다', async () => {
    const params = { ...newKdfParams('argon2id'), memorySize: 8192, iterations: 1 }
    const key = await deriveMasterKey(PASS, params)
    const nonce = new Uint8Array(12)
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      new TextEncoder().encode('확인'),
    )
    const same = await deriveMasterKey(PASS, params)
    const back = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, same, ct)
    expect(new TextDecoder().decode(back)).toBe('확인')
  })
})

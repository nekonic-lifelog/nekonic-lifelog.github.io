import { describe, expect, it } from 'vitest'
import { importDataKey, openJson, sealJson } from '../src/crypto/cipher'
import { createEnvelope } from '../src/crypto/envelope'
import { fromBase64, randomBytes, toBase64 } from '../src/crypto/kdf'
import {
  LinkError,
  decodeLinkPayload,
  encodeLinkPayload,
  type LinkPayload,
} from '../src/link/payload'
import { decodeQrFromImageData, matrixToImageData, toQrMatrix } from '../src/link/qr'

const TOKEN = 'github_pat_test-token-do-not-use'.padEnd(93, '0')
const REPO = { owner: 'nekonic-lifelog', repo: 'nekonic-lifelog.github.io', branch: 'main' }
const SCALE = 4
const QUIET = 4

function samplePayload(over: Partial<LinkPayload> = {}): LinkPayload {
  return {
    v: 1,
    key: toBase64(randomBytes(32)),
    token: TOKEN,
    deviceId: crypto.randomUUID(),
    repo: REPO,
    ...over,
  }
}

async function throughQr(text: string): Promise<string | null> {
  const matrix = await toQrMatrix(text)
  const image = matrixToImageData(matrix, SCALE, QUIET)
  return decodeQrFromImageData(image.data, image.width, image.height)
}

function caught(run: () => unknown): Error {
  try {
    run()
  } catch (err) {
    return err as Error
  }
  throw new Error('거절했어야 하는데 통과했습니다')
}

describe('연결 페이로드 코덱', () => {
  it('넣은 그대로 돌아온다', () => {
    const payload = samplePayload()
    expect(decodeLinkPayload(encodeLinkPayload(payload))).toEqual(payload)
  })

  it('데이터 키 32바이트를 그대로 실어 나른다', () => {
    const raw = randomBytes(32)
    const back = decodeLinkPayload(encodeLinkPayload(samplePayload({ key: toBase64(raw) })))
    expect([...fromBase64(back.key)]).toEqual([...raw])
  })

  it('기기 ID를 그대로 물려준다', () => {
    const deviceId = crypto.randomUUID()
    expect(decodeLinkPayload(encodeLinkPayload(samplePayload({ deviceId }))).deviceId).toBe(
      deviceId,
    )
  })

  it('키 길이가 32바이트가 아니면 만들지 않는다', () => {
    expect(() => encodeLinkPayload(samplePayload({ key: toBase64(randomBytes(16)) }))).toThrow(
      LinkError,
    )
  })

  it('빈 칸이 있으면 만들지 않는다', () => {
    expect(() => encodeLinkPayload(samplePayload({ token: '' }))).toThrow(LinkError)
    expect(() =>
      encodeLinkPayload(samplePayload({ repo: { ...REPO, branch: '' } })),
    ).toThrow(LinkError)
  })
})

describe('QR 왕복', () => {
  it('페이로드가 QR을 거쳐 원본과 똑같이 돌아온다', async () => {
    const payload = samplePayload()
    const text = encodeLinkPayload(payload)
    const scanned = await throughQr(text)
    expect(scanned).toBe(text)
    expect(decodeLinkPayload(scanned ?? '')).toEqual(payload)
  })

  it('실제 크기의 키·토큰·기기 ID·레포가 QR 한 장에 들어간다', async () => {
    const text = encodeLinkPayload(samplePayload())
    const matrix = await toQrMatrix(text)
    expect(text.length).toBeLessThan(280)
    expect(matrix.size).toBeLessThanOrEqual(77)
    expect(await throughQr(text)).toBe(text)
  })

  it('여러 번 만들어도 매번 읽힌다', async () => {
    for (let i = 0; i < 5; i++) {
      const text = encodeLinkPayload(samplePayload())
      expect(await throughQr(text)).toBe(text)
    }
  })
})

describe('QR을 거친 뒤 실제로 데이터가 열린다', () => {
  it('보낸 기기가 잠근 것을 받은 기기가 연다', async () => {
    const sender = await createEnvelope('correct horse battery staple 열두글자', 'pbkdf2')
    const record = { id: 'record-1', at: '2026-07-28T09:00:00.000Z', value: 700 }
    const blob = await sealJson(sender.dataKey, record)

    const text = encodeLinkPayload(samplePayload({ key: toBase64(sender.raw) }))
    const scanned = await throughQr(text)
    const received = decodeLinkPayload(scanned ?? '')
    const receiverKey = await importDataKey(fromBase64(received.key))

    expect(await openJson(receiverKey, blob)).toEqual(record)
  })

  it('QR을 거치지 않은 다른 키로는 열리지 않는다', async () => {
    const sender = await createEnvelope('correct horse battery staple 열두글자', 'pbkdf2')
    const blob = await sealJson(sender.dataKey, { 비밀: '내용' })
    const stranger = await importDataKey(randomBytes(32))
    await expect(openJson(stranger, blob)).rejects.toThrow()
  })
})

describe('망가진 코드는 거절한다', () => {
  it('한 글자만 달라져도 거절한다', () => {
    const text = encodeLinkPayload(samplePayload())
    const at = 10
    const swapped = text[at] === 'A' ? 'B' : 'A'
    const broken = text.slice(0, at) + swapped + text.slice(at + 1)
    expect(() => decodeLinkPayload(broken)).toThrow(/손상/)
  })

  it('뒤가 잘리면 거절한다', () => {
    const text = encodeLinkPayload(samplePayload())
    expect(() => decodeLinkPayload(text.slice(0, Math.floor(text.length / 2)))).toThrow(/잘렸/)
    expect(() => decodeLinkPayload(text.slice(0, text.length - 3))).toThrow(LinkError)
  })

  it('전혀 다른 QR은 거절한다', async () => {
    const scanned = await throughQr('https://example.com/이건 연결 코드가 아니다')
    expect(scanned).toBe('https://example.com/이건 연결 코드가 아니다')
    expect(() => decodeLinkPayload(scanned ?? '')).toThrow(/기기 연결 코드가 아닙니다/)
  })

  it('빈 문자열은 거절한다', () => {
    expect(() => decodeLinkPayload('')).toThrow(LinkError)
  })

  it('앞으로 나올 버전은 갱신하라고 안내한다', () => {
    const text = encodeLinkPayload(samplePayload({ v: 2 }))
    const err = caught(() => decodeLinkPayload(text))
    expect(err).toBeInstanceOf(LinkError)
    expect(err.message).toMatch(/갱신/)
  })

  it('오류 메시지에 토큰이나 키가 실리지 않는다', () => {
    const payload = samplePayload()
    const text = encodeLinkPayload(payload)
    const messages = [
      caught(() => decodeLinkPayload(text.slice(0, 40))).message,
      caught(() => decodeLinkPayload(`${text}x`)).message,
      caught(() => decodeLinkPayload(text.replace('LLNK', 'XXXX'))).message,
      caught(() => decodeLinkPayload(encodeLinkPayload({ ...payload, v: 9 }))).message,
    ]
    for (const message of messages) {
      expect(message).not.toContain(payload.token)
      expect(message).not.toContain(payload.key)
      expect(message).not.toContain(payload.key.slice(0, 12))
      expect(message).not.toContain('github_pat')
    }
  })
})

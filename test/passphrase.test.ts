import { describe, expect, it } from 'vitest'
import {
  EnvelopeError,
  addPassphrase,
  createEnvelope,
  openEnvelope,
  removeWrapAt,
} from '../src/crypto/envelope'

const FIRST = 'first-passphrase-do-not-use'
const SECOND = 'second-passphrase-do-not-use'

async function seeded() {
  const made = await createEnvelope(FIRST, 'pbkdf2')
  return made
}

describe('암호구절 — 잠기지 않고 바꾸는 순서', () => {
  it('새 암호구절을 더해도 옛 것이 계속 열린다', async () => {
    const made = await seeded()
    const two = await addPassphrase(made.envelope, made.raw, SECOND, 'pbkdf2')

    expect(two.wraps).toHaveLength(2)
    await expect(openEnvelope(two, FIRST)).resolves.toBeTruthy()
    await expect(openEnvelope(two, SECOND)).resolves.toBeTruthy()
  })

  it('두 암호구절이 같은 데이터키를 연다', async () => {
    const made = await seeded()
    const two = await addPassphrase(made.envelope, made.raw, SECOND, 'pbkdf2')

    const a = await openEnvelope(two, FIRST)
    const b = await openEnvelope(two, SECOND)

    expect(Array.from(a.raw)).toEqual(Array.from(b.raw))
  })

  it('새 것을 확인한 뒤 옛 것을 지우면 새 것으로만 열린다', async () => {
    const made = await seeded()
    const two = await addPassphrase(made.envelope, made.raw, SECOND, 'pbkdf2')
    const one = removeWrapAt(two, 0)

    expect(one.wraps).toHaveLength(1)
    await expect(openEnvelope(one, SECOND)).resolves.toBeTruthy()
    await expect(openEnvelope(one, FIRST)).rejects.toThrow(EnvelopeError)
  })

  it('마지막 하나는 지울 수 없다 — 지우면 영영 못 연다', async () => {
    const made = await seeded()

    expect(() => removeWrapAt(made.envelope, 0)).toThrow(EnvelopeError)
    expect(() => removeWrapAt(made.envelope, 0)).toThrow(/마지막/)
  })

  it('틀린 암호구절로는 열리지 않는다', async () => {
    const made = await seeded()

    await expect(openEnvelope(made.envelope, SECOND)).rejects.toThrow(EnvelopeError)
  })

  it('같은 암호구절을 두 번 더해도 각각 열린다', async () => {
    const made = await seeded()
    const two = await addPassphrase(made.envelope, made.raw, FIRST, 'pbkdf2')

    expect(two.wraps).toHaveLength(2)
    expect(two.wraps[0]!.nonce).not.toBe(two.wraps[1]!.nonce)
    expect(two.wraps[0]!.ct).not.toBe(two.wraps[1]!.ct)
    await expect(openEnvelope(removeWrapAt(two, 0), FIRST)).resolves.toBeTruthy()
  })
})

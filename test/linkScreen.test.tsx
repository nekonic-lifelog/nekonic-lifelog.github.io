// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createEnvelope } from '../src/crypto/envelope'
import { randomBytes, toBase64 } from '../src/crypto/kdf'
import { acceptLinkPayload } from '../src/link/accept'
import type { LinkPayload } from '../src/link/payload'
import { Link } from '../src/screens/Link'

const MINE = 'phone-이-기기'

function mount() {
  return render(
    createElement(Link, {
      deviceId: MINE,
      buildPayload: async () => {
        throw new Error('쓰지 않습니다')
      },
      acceptPayload: async () => undefined,
      acceptManual: async () => undefined,
    }),
  )
}

function cardOf(heading: string): HTMLElement {
  return screen.getByRole('heading', { name: heading }).closest('.card') as HTMLElement
}

afterEach(cleanup)

describe('기기 연결 화면 — 기기 ID 안내', () => {
  it('QR로 잇는 쪽에도 기기 ID 안내가 있다', () => {
    mount()

    expect(within(cardOf('QR로 잇기')).getByText(/자기 기기 ID를 그대로/)).toBeTruthy()
  })

  it('손으로 잇는 쪽에도 같은 안내가 있다', () => {
    mount()

    expect(
      within(cardOf('손으로 입력해서 잇기')).getByText(/자기 기기 ID를 그대로/),
    ).toBeTruthy()
  })

  it('두 길의 안내가 서로 어긋나지 않는다', () => {
    mount()

    for (const heading of ['QR로 잇기', '손으로 입력해서 잇기']) {
      expect(within(cardOf(heading)).queryByText(/기기 ID는 새로 발급/)).toBeNull()
    }
  })

  it('보내는 쪽으로 넘겨도 이 기기 ID가 그대로 보인다', async () => {
    const user = userEvent.setup()
    mount()

    await user.click(screen.getByRole('button', { name: '다른 기기에 넘기기' }))

    expect(screen.getByText(MINE)).toBeTruthy()
  })

  it('안내가 실제 수락 동작과 맞다 — 보낸 기기의 ID를 물려받지 않는다', async () => {
    const payload: LinkPayload = {
      v: 1,
      key: toBase64(randomBytes(32)),
      token: 'test-token-do-not-use',
      deviceId: 'pc-보낸기기',
      repo: { owner: 'me', repo: 'lifelog-data', branch: 'main' },
    }
    const accepted = await acceptLinkPayload(payload, {
      envelopeFor: async () => (await createEnvelope('암호구절')).envelope,
    })

    expect('deviceId' in accepted).toBe(false)
    expect(JSON.stringify({ ...accepted, dataKey: null })).not.toContain('pc-보낸기기')
  })
})

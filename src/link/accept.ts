import { importDataKey } from '../crypto/cipher'
import type { Envelope } from '../crypto/envelope'
import { fromBase64 } from '../crypto/kdf'
import { LinkError, type LinkPayload } from './payload'

export interface AcceptedLink {
  dataKey: CryptoKey
  envelope: Envelope
  token: string
  remote: { owner: string; repo: string; branch: string }
}

export interface AcceptDeps {
  envelopeFor(remote: AcceptedLink['remote'], token: string): Promise<Envelope>
}

export async function acceptLinkPayload(
  payload: LinkPayload,
  deps: AcceptDeps,
): Promise<AcceptedLink> {
  const remote = { ...payload.repo }
  const raw = fromBase64(payload.key)
  if (raw.length !== 32) throw new LinkError('데이터 키 길이가 맞지 않습니다.')
  const envelope = await deps.envelopeFor(remote, payload.token)
  return {
    dataKey: await importDataKey(raw),
    envelope,
    token: payload.token,
    remote,
  }
}

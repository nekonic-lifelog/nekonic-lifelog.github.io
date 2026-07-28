import { openEnvelope, parseEnvelope } from '../crypto/envelope'
import { importDataKey } from '../crypto/cipher'
import { fromBase64, toBase64 } from '../crypto/kdf'
import { LinkError, type LinkPayload } from '../link/payload'
import { GithubRepo } from '../remote/github'
import { idbCredentials, type RemoteConfig } from '../sync/credentials'
import { ENVELOPE_PATH, SyncSetupError, useSync } from '../state/sync'
import { useApp } from '../state/app'
import { Link } from './Link'

async function envelopeFrom(remote: RemoteConfig, token: string) {
  const repo = new GithubRepo({ ...remote }, token)
  const text = await repo.readTextFile(ENVELOPE_PATH)
  if (text === null) {
    throw new SyncSetupError(
      '저장소에 봉투가 없습니다. 먼저 기존 기기에서 저장소에 이어 주세요.',
    )
  }
  return parseEnvelope(text)
}

export function LinkDevice() {
  const app = useApp()
  const sync = useSync()

  return (
    <Link
      deviceId={app.deviceId}
      buildPayload={async (passphrase) => {
        const creds = await idbCredentials().load()
        if (!creds) {
          throw new SyncSetupError('이 기기가 아직 저장소에 이어져 있지 않습니다.')
        }
        const opened = await openEnvelope(creds.envelope, passphrase)
        return {
          v: 1,
          key: toBase64(opened.raw),
          token: creds.token,
          deviceId: app.deviceId,
          repo: { ...creds.remote },
        }
      }}
      acceptPayload={async (payload: LinkPayload) => {
        const remote = { ...payload.repo }
        const envelope = await envelopeFrom(remote, payload.token)
        const raw = fromBase64(payload.key)
        if (raw.length !== 32) throw new LinkError('데이터 키 길이가 맞지 않습니다.')
        const dataKey = await importDataKey(raw)
        await app.adoptDeviceId(payload.deviceId)
        await sync.connectWithKey({ dataKey, envelope, token: payload.token, remote })
      }}
      acceptManual={async ({ token, owner, repo, branch, passphrase }) => {
        const remote: RemoteConfig = {
          owner: owner.trim(),
          repo: repo.trim(),
          branch: branch.trim() || 'main',
        }
        await sync.connect({ token: token.trim(), remote, passphrase })
      }}
    />
  )
}

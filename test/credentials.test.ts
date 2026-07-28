import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { importDataKey, openJson, sealJson } from '../src/crypto/cipher'
import { createEnvelope } from '../src/crypto/envelope'
import { randomBytes } from '../src/crypto/kdf'
import {
  emptyCache,
  idbCredentials,
  idbSyncCache,
  memoryCredentials,
  memorySyncCache,
  type Credentials,
  type RemoteConfig,
} from '../src/sync/credentials'

const TOKEN = 'test-token-do-not-use'
const REMOTE: RemoteConfig = { owner: 'nekonic', repo: 'lifelog', branch: 'main' }
const PASSPHRASE = '열쇠 구절 테스트'

function wipe(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('lifelog-keys')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('deleteDatabase가 blocked 되었습니다'))
  })
}

async function makeCredentials(): Promise<Credentials> {
  const opened = await createEnvelope(PASSPHRASE, 'pbkdf2')
  return { dataKey: opened.dataKey, envelope: opened.envelope, token: TOKEN, remote: REMOTE }
}

beforeEach(async () => {
  await wipe()
})

describe('자격 보관', () => {
  it('저장한 적이 없으면 null이다', async () => {
    expect(await idbCredentials().load()).toBeNull()
  })

  it('저장했다가 새 연결로 다시 읽으면 그 키로 복호화할 수 있다', async () => {
    const creds = await makeCredentials()
    const blob = await sealJson(creds.dataKey, { 기록: ['물 500ml'] })

    await idbCredentials().save(creds)

    const reopened = await idbCredentials().load()
    expect(reopened).not.toBeNull()
    expect(reopened?.token).toBe(TOKEN)
    expect(reopened?.remote).toEqual(REMOTE)
    expect(reopened?.envelope.wraps).toHaveLength(1)
    expect(await openJson(reopened!.dataKey, blob)).toEqual({ 기록: ['물 500ml'] })
  })

  it('되읽은 키에서 바이트를 꺼낼 수 없다', async () => {
    await idbCredentials().save(await makeCredentials())
    const reopened = await idbCredentials().load()
    expect(reopened?.dataKey.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', reopened!.dataKey)).rejects.toThrow()
  })

  it('저장한 값 어디에도 키 바이트가 담기지 않는다', async () => {
    const creds = await makeCredentials()
    await idbCredentials().save(creds)
    const raw = await new Promise<unknown>((resolve, reject) => {
      const req = indexedDB.open('lifelog-keys')
      req.onsuccess = () => {
        const db = req.result
        const get = db.transaction('creds', 'readonly').objectStore('creds').get('current')
        get.onsuccess = () => {
          db.close()
          resolve(get.result)
        }
        get.onerror = () => {
          db.close()
          reject(get.error)
        }
      }
      req.onerror = () => reject(req.error)
    })
    const stored = (raw as { value: Record<string, unknown> }).value
    expect(stored['dataKey']).toBeInstanceOf(CryptoKey)
    expect((stored['dataKey'] as CryptoKey).extractable).toBe(false)
    expect(JSON.stringify(stored['dataKey'])).not.toContain('raw')
  })

  it('지우고 나면 다시 null이다', async () => {
    const vault = idbCredentials()
    await vault.save(await makeCredentials())
    expect(await vault.load()).not.toBeNull()
    await vault.clear()
    expect(await vault.load()).toBeNull()
  })

  it('망가진 값은 없는 것으로 친다', async () => {
    await idbSyncCache().save(emptyCache())
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('lifelog-keys')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('creds', 'readwrite')
      tx.objectStore('creds').put({ key: 'current', value: { token: 42 } })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    expect(await idbCredentials().load()).toBeNull()
  })

  it('메모리 보관도 같은 약속을 지킨다', async () => {
    const vault = memoryCredentials()
    const creds = await makeCredentials()
    expect(await vault.load()).toBeNull()
    await vault.save(creds)
    expect((await vault.load())?.token).toBe(TOKEN)
    await vault.clear()
    expect(await vault.load()).toBeNull()
  })
})

describe('트리 캐시', () => {
  it('빈 캐시로 시작한다', async () => {
    expect(await idbSyncCache().load()).toEqual(emptyCache())
  })

  it('저장한 sha 목록이 새 연결에서도 그대로다', async () => {
    await idbSyncCache().save({
      commitSha: 'c1',
      blobs: { '/todos/phone.enc': 'sha-a' },
      pushed: { '/todos/phone.enc': 'mark-a' },
      backfilled: true,
      reminders: null,
    })
    const again = await idbSyncCache().load()
    expect(again.commitSha).toBe('c1')
    expect(again.blobs['/todos/phone.enc']).toBe('sha-a')
    expect(again.pushed['/todos/phone.enc']).toBe('mark-a')
    expect(again.backfilled).toBe(true)
    await idbSyncCache().clear()
    expect(await idbSyncCache().load()).toEqual(emptyCache())
  })

  it('메모리 캐시는 넘겨준 객체를 붙들지 않는다', async () => {
    const cache = memorySyncCache()
    const data = { ...emptyCache(), blobs: { a: '1' } }
    await cache.save(data)
    data.blobs['a'] = '2'
    expect((await cache.load()).blobs['a']).toBe('1')
  })

  it('키 바이트를 따로 심어도 자격에는 섞이지 않는다', async () => {
    const key = await importDataKey(randomBytes(32))
    await idbCredentials().save({
      dataKey: key,
      envelope: (await createEnvelope(PASSPHRASE, 'pbkdf2')).envelope,
      token: TOKEN,
      remote: REMOTE,
    })
    const loaded = await idbCredentials().load()
    expect(loaded?.dataKey.usages.sort()).toEqual(['decrypt', 'encrypt'])
    await expect(crypto.subtle.exportKey('raw', loaded!.dataKey)).rejects.toThrow()
  })
})

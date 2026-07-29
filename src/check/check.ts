import { cacheVersionOf, swVerdict, usageVerdict, type Verdict } from './diagnose'

const PROBE_DB = 'lifelog-probe'
const PROBE_STORE = 'probe'
const APP_DB = 'lifelog'

const app = document.getElementById('app')!

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props)
  for (const child of children) node.append(child)
  return node
}

interface Card {
  out: HTMLElement
  actions: HTMLElement
}

function card(n: number, title: string, why: string): Card {
  const out = el('div', { className: 'out' })
  const actions = el('div', { className: 'row' })
  app.append(
    el('section', { className: 'card' }, [
      el('h2', { textContent: `${n}. ${title}` }),
      el('p', { className: 'why', textContent: why }),
      actions,
      out,
    ]),
  )
  return { out, actions }
}

function report(out: HTMLElement, verdict: Verdict, lines: string[]) {
  out.className = `out ${verdict}`
  out.textContent = lines.join('\n')
}

function button(label: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const b = el('button', { type: 'button', textContent: label })
  b.addEventListener('click', () => {
    b.disabled = true
    void Promise.resolve(onClick()).finally(() => {
      b.disabled = false
    })
  })
  return b
}

function environment() {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true

  app.append(
    el('h1', { textContent: '환경 점검' }),
    el('p', {
      className: 'lede',
      textContent:
        '이 기기가 무엇을 지원하는지 확인합니다. 실제로 쓸 기기에서 열어야 의미가 있습니다.',
    }),
    el('section', { className: 'card' }, [
      el('h2', { textContent: '실행 환경' }),
      el('p', {
        className: 'env',
        textContent: [
          `홈 화면 설치: ${standalone ? '예' : '아니오'}`,
          `보안 컨텍스트: ${window.isSecureContext ? '예' : '아니오'}`,
          `화면: ${window.screen.width}×${window.screen.height} @${window.devicePixelRatio}x`,
          `UA: ${navigator.userAgent}`,
        ].join('\n'),
      }),
    ]),
  )
  return { standalone }
}

function probeKeyDerivation() {
  const { out, actions } = card(
    1,
    '키 유도 속도',
    'WASM 모듈이 불러와지는지, 메모리를 많이 쓰는 해시가 이 기기에서 견딜 만한지 잽니다. ' +
      '2~3초 안이면 쓸 만합니다.',
  )

  actions.append(
    button('WASM 측정', async () => {
      report(out, 'warn', ['WASM 불러오는 중…'])
      try {
        const t0 = performance.now()
        const { argon2id } = await import('hash-wasm')
        const loaded = performance.now() - t0

        const salt = crypto.getRandomValues(new Uint8Array(16))
        const t1 = performance.now()
        const hash = await argon2id({
          password: '측정용 문자열',
          salt,
          parallelism: 1,
          iterations: 3,
          memorySize: 65536,
          hashLength: 32,
          outputType: 'hex',
        })
        const derive = performance.now() - t1

        const verdict: Verdict = derive <= 3000 ? 'ok' : derive <= 6000 ? 'warn' : 'bad'
        report(out, verdict, [
          `WASM 로드: ${loaded.toFixed(0)}ms`,
          `유도(메모리 64MB, 3회): ${derive.toFixed(0)}ms`,
          `결과 앞자리: ${hash.slice(0, 16)}…`,
          '',
          verdict === 'ok'
            ? '쓸 만합니다.'
            : verdict === 'warn'
              ? '느립니다. 메모리 설정을 낮추는 편이 낫습니다.'
              : '너무 느립니다. 다른 방식을 써야 합니다.',
        ])
      } catch (err) {
        report(out, 'bad', [
          `실패: ${err instanceof Error ? err.message : String(err)}`,
          '',
          'WASM을 불러오지 못했습니다. 아래 네이티브 방식과 비교해 보세요.',
        ])
      }
    }),
    button('네이티브 비교', async () => {
      report(out, 'warn', ['측정 중…'])
      const salt = crypto.getRandomValues(new Uint8Array(16))
      const base = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode('측정용 문자열'),
        'PBKDF2',
        false,
        ['deriveBits'],
      )
      const t0 = performance.now()
      await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 },
        base,
        256,
      )
      report(out, 'ok', [
        `네이티브 PBKDF2 600,000회: ${(performance.now() - t0).toFixed(0)}ms`,
        '',
        'WASM을 못 쓸 때의 기준값입니다.',
      ])
    }),
  )
}

function probeKeyStorage() {
  const { out, actions } = card(
    2,
    '키 객체 저장 후 재사용',
    '꺼낼 수 없는 형태의 키를 저장소에 넣고, 앱을 껐다 켠 뒤에도 그 키로 복호화가 되는지 봅니다. ' +
      '저장한 뒤 앱을 완전히 닫았다가 다시 여세요.',
  )

  const PLAINTEXT = '왕복 확인 문자열'

  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(PROBE_DB, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(PROBE_STORE)) {
          db.createObjectStore(PROBE_STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })

  const read = async () => {
    const db = await open()
    const row = await new Promise<
      { id: string; key: CryptoKey; iv: Uint8Array; ct: ArrayBuffer } | undefined
    >((resolve, reject) => {
      const r = db.transaction(PROBE_STORE).objectStore(PROBE_STORE).get('probe')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    db.close()
    return row
  }

  actions.append(
    button('1단계: 저장', async () => {
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ])
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(PLAINTEXT),
      )
      const db = await open()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(PROBE_STORE, 'readwrite')
        tx.objectStore(PROBE_STORE).put({ id: 'probe', key, iv, ct })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
      db.close()
      report(out, 'ok', [
        '저장했습니다.',
        '',
        '이제 앱을 완전히 닫았다가(앱 전환기에서 밀어 종료) 다시 열고 2단계를 누르세요.',
        '그래야 "재기동 후에도 살아남는가"를 재는 것이 됩니다.',
      ])
    }),
    button('2단계: 복호화', async () => {
      const row = await read()
      if (!row) {
        report(out, 'warn', ['저장된 것이 없습니다. 먼저 1단계를 실행하세요.'])
        return
      }
      try {
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(row.iv) },
          row.key,
          row.ct,
        )
        const match = new TextDecoder().decode(plain) === PLAINTEXT
        report(out, match ? 'ok' : 'bad', [
          `키 타입: ${row.key.constructor.name}`,
          `extractable: ${row.key.extractable}`,
          `복호화 결과 일치: ${match ? '예' : '아니오'}`,
          '',
          match
            ? row.key.extractable === false
              ? '살아남았습니다. 앱을 재시작한 뒤에도 이 결과가 나와야 합니다.'
              : 'extractable이 false가 아닙니다. 저장 경로를 확인하세요.'
            : '복호화가 어긋났습니다.',
        ])
      } catch (err) {
        report(out, 'bad', [
          `복호화 실패: ${err instanceof Error ? err.message : String(err)}`,
          '',
          '키 객체가 저장소를 건너 살아남지 못했습니다.',
        ])
      }
    }),
    button('지우기', async () => {
      const db = await open()
      await new Promise<void>((resolve) => {
        const tx = db.transaction(PROBE_STORE, 'readwrite')
        tx.objectStore(PROBE_STORE).delete('probe')
        tx.oncomplete = () => resolve()
      })
      db.close()
      report(out, 'warn', ['지웠습니다.'])
    }),
  )

  void read().then((row) => {
    if (row) {
      report(out, 'warn', [
        '이전에 저장한 키가 있습니다. 앱을 재시작한 상태라면 2단계를 누르세요.',
      ])
    }
  })
}

function probeCompression() {
  const { out, actions } = card(
    3,
    'CompressionStream',
    '브라우저 내장 gzip이 있는지, 왕복이 정확한지 봅니다 (Safari 16.4+).',
  )

  actions.append(
    button('압축 왕복', async () => {
      if (typeof CompressionStream === 'undefined') {
        report(out, 'bad', ['CompressionStream이 없습니다. 압축 없이 가야 합니다.'])
        return
      }
      try {
        const sample = JSON.stringify(
          Array.from({ length: 300 }, (_, i) => ({
            id: `record-${i}`,
            defId: 'definition-0001',
            at: '2026-07-27T09:00:00.000Z',
            value: 1,
            deleted: false,
          })),
        )
        const bytes = new TextEncoder().encode(sample)

        const gz = new Response(
          new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),
        )
        const packed = new Uint8Array(await gz.arrayBuffer())

        const un = new Response(
          new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip')),
        )
        const back = new Uint8Array(await un.arrayBuffer())
        const same = new TextDecoder().decode(back) === sample

        report(out, same ? 'ok' : 'bad', [
          `원본: ${bytes.length.toLocaleString()} B`,
          `압축: ${packed.length.toLocaleString()} B (${((packed.length / bytes.length) * 100).toFixed(1)}%)`,
          `왕복 일치: ${same ? '예' : '아니오'}`,
        ])
      } catch (err) {
        report(out, 'bad', [`실패: ${err instanceof Error ? err.message : String(err)}`])
      }
    }),
  )
}

function probePersist() {
  const { out, actions } = card(
    4,
    'navigator.storage.persist()',
    '이 API가 있는지, 있다면 무엇을 돌려주는지 봅니다. 없어도 앱은 정상 동작해야 합니다.',
  )

  actions.append(
    button('확인', async () => {
      const hasApi = typeof navigator.storage?.persist === 'function'
      const lines = [`storage.persist 존재: ${hasApi ? '예' : '아니오'}`]
      let verdict: Verdict = hasApi ? 'ok' : 'warn'

      if (hasApi) {
        try {
          lines.push(`persist() 반환: ${await navigator.storage.persist()}`)
        } catch (err) {
          lines.push(`persist() 예외: ${err instanceof Error ? err.message : String(err)}`)
          verdict = 'warn'
        }
      }
      if (typeof navigator.storage?.persisted === 'function') {
        lines.push(`persisted(): ${await navigator.storage.persisted()}`)
      }
      if (typeof navigator.storage?.estimate === 'function') {
        const est = await navigator.storage.estimate()
        lines.push(
          `할당량: ${est.quota ? (est.quota / 1e6).toFixed(0) + ' MB' : '알 수 없음'}`,
        )
      }
      lines.push('', hasApi ? '반환이 false여도 정상입니다.' : '없는 것도 흔한 결과입니다.')
      report(out, verdict, lines)
    }),
  )
}

function probeCamera(standalone: boolean) {
  const { out, actions } = card(
    5,
    '설치된 앱에서 카메라',
    '홈 화면에 설치한 상태에서 카메라가 열리는지 봅니다 — ' +
      `지금은 ${standalone ? '설치 상태입니다' : '설치 상태가 아닙니다. 설치 후 다시 여세요'}.`,
  )

  const video = el('video', { autoplay: true, muted: true, playsInline: true })
  video.style.cssText =
    'width:100%;max-width:280px;border-radius:8px;margin-top:10px;display:none'

  actions.append(
    button('카메라 열기', async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        report(out, 'bad', ['getUserMedia가 없습니다.'])
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        video.srcObject = stream
        video.style.display = 'block'
        const track = stream.getVideoTracks()[0]
        report(out, standalone ? 'ok' : 'warn', [
          `카메라 열림: ${track?.label || '(라벨 없음)'}`,
          `설치 상태: ${standalone ? '예' : '아니오'}`,
          '',
          standalone
            ? '설치된 상태에서도 카메라를 쓸 수 있습니다.'
            : '설치하지 않은 상태의 결과입니다. 홈 화면에 추가한 뒤 다시 확인하세요.',
        ])
        setTimeout(() => {
          for (const t of stream.getTracks()) t.stop()
          video.style.display = 'none'
        }, 5000)
      } catch (err) {
        report(out, 'bad', [
          `실패: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
          `설치 상태: ${standalone ? '예' : '아니오'}`,
          '',
          standalone
            ? '설치된 상태에서 카메라를 쓸 수 없습니다.'
            : '설치 상태에서 다시 확인해야 결론을 낼 수 있습니다.',
        ])
      }
    }),
  )
  actions.after(video)
}

function probeServiceWorker() {
  const { out, actions } = card(
    6,
    '서비스워커와 캐시',
    '오프라인에서 앱이 뜨는지, 새 버전이 대기 중인지, 옛 캐시가 남았는지 봅니다.',
  )

  actions.append(
    button('확인', async () => {
      const supported = 'serviceWorker' in navigator
      if (!supported) {
        const judged = swVerdict({
          supported: false,
          registered: false,
          hasActive: false,
          hasWaiting: false,
          controlled: false,
          caches: [],
        })
        report(out, judged.verdict, judged.lines)
        return
      }

      const reg = await navigator.serviceWorker.getRegistration()
      const names = 'caches' in self ? await caches.keys() : []
      const judged = swVerdict({
        supported: true,
        registered: reg !== undefined,
        hasActive: reg?.active != null,
        hasWaiting: reg?.waiting != null,
        controlled: navigator.serviceWorker.controller !== null,
        caches: cacheVersionOf(names),
      })
      report(out, judged.verdict, judged.lines)
    }),
  )
}

function probeStorageUsage() {
  const { out, actions } = card(
    7,
    '저장소 사용량',
    '얼마나 쓰고 있고 얼마나 남았는지 봅니다. 앱 데이터는 읽지 않고 크기만 묻습니다.',
  )

  actions.append(
    button('확인', async () => {
      if (typeof navigator.storage?.estimate !== 'function') {
        report(out, 'warn', [
          'storage.estimate가 없습니다.',
          '',
          '이 기기에서는 남은 공간을 알 수 없습니다.',
        ])
        return
      }
      const est = await navigator.storage.estimate()
      const judged = usageVerdict(est.usage, est.quota)
      report(out, judged.verdict, judged.lines)
    }),
  )
}

function probeAppData() {
  const { out, actions } = card(
    8,
    '앱 데이터가 있는지',
    '앱 저장소의 행 수만 셉니다. 내용은 읽지 않고 쓰지도 않습니다.',
  )

  actions.append(
    button('세어보기', async () => {
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const req = indexedDB.open(APP_DB)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
      })
      if (db === null) {
        report(out, 'warn', ['앱 저장소를 열지 못했습니다.'])
        return
      }

      const names = Array.from(db.objectStoreNames)
      if (names.length === 0) {
        db.close()
        report(out, 'warn', ['앱 저장소가 비어 있습니다.', '', '아직 앱을 쓰지 않았거나 지워졌습니다.'])
        return
      }

      const lines: string[] = []
      let total = 0
      for (const name of names) {
        const n = await new Promise<number>((resolve) => {
          const req = db.transaction(name, 'readonly').objectStore(name).count()
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(-1)
        })
        lines.push(`${name}: ${n < 0 ? '셀 수 없음' : `${n}행`}`)
        if (n > 0) total += n
      }
      db.close()

      lines.push('', total > 0 ? '앱 데이터가 남아 있습니다.' : '아직 아무것도 없습니다.')
      report(out, total > 0 ? 'ok' : 'warn', lines)
    }),
  )
}

function probeOfflineShell() {
  const { out, actions } = card(
    9,
    '오프라인에서 이 페이지',
    '이 진단 페이지가 캐시에 있는지 봅니다. 없으면 정작 오프라인일 때 이 페이지를 열 수 없습니다.',
  )

  actions.append(
    button('확인', async () => {
      if (!('caches' in self)) {
        report(out, 'warn', ['Cache Storage가 없습니다.'])
        return
      }
      const wanted = ['/check.html', '/index.html']
      const lines: string[] = []
      let missing = 0
      for (const path of wanted) {
        const hit = await caches.match(path)
        lines.push(`${path}: ${hit ? '캐시에 있음' : '없음'}`)
        if (!hit) missing += 1
      }
      lines.push(
        '',
        missing === 0
          ? '망이 끊겨도 이 페이지와 앱이 열립니다.'
          : '캐시에 없는 것이 있습니다. 서비스워커가 아직 설치되지 않았을 수 있습니다.',
      )
      report(out, missing === 0 ? 'ok' : 'warn', lines)
    }),
  )
}

const { standalone } = environment()
probeKeyDerivation()
probeKeyStorage()
probeCompression()
probePersist()
probeCamera(standalone)
probeServiceWorker()
probeStorageUsage()
probeAppData()
probeOfflineShell()

app.append(
  el('p', {
    className: 'lede',
    textContent: '진단 전용 페이지입니다. 앱 데이터에는 손대지 않고 별도 저장소만 씁니다.',
  }),
)

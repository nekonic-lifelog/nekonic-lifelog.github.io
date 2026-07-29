import { describe, expect, it } from 'vitest'
import {
  cacheVersionOf,
  formatBytes,
  swVerdict,
  usageVerdict,
  type SwFacts,
} from '../src/check/diagnose'

describe('캐시 이름에서 버전 뽑기', () => {
  it('lifelog- 뒤를 버전으로 본다', () => {
    expect(cacheVersionOf(['lifelog-a76ad594b965'])).toEqual(['a76ad594b965'])
  })

  it('여러 개면 여러 개를 돌려준다 — 옛 캐시가 남았다는 뜻이다', () => {
    expect(cacheVersionOf(['lifelog-aaa', 'lifelog-bbb'])).toEqual(['aaa', 'bbb'])
  })

  it('우리 것이 아닌 캐시는 세지 않는다', () => {
    expect(cacheVersionOf(['other-thing', 'lifelog-aaa'])).toEqual(['aaa'])
  })

  it('하나도 없으면 빈 목록이다', () => {
    expect(cacheVersionOf([])).toEqual([])
  })
})

describe('서비스워커 판정', () => {
  const facts = (partial: Partial<SwFacts> = {}): SwFacts => ({
    supported: true,
    registered: true,
    hasActive: true,
    hasWaiting: false,
    controlled: true,
    caches: ['aaa'],
    ...partial,
  })

  it('등록되고 조종 중이면 정상이다', () => {
    expect(swVerdict(facts()).verdict).toBe('ok')
  })

  it('지원하지 않으면 경고다', () => {
    const r = swVerdict(facts({ supported: false }))
    expect(r.verdict).toBe('warn')
    expect(r.lines.join(' ')).toMatch(/지원하지 않/)
  })

  it('등록이 없으면 나쁨이다 — 오프라인이 안 된다', () => {
    const r = swVerdict(facts({ registered: false, hasActive: false, controlled: false }))
    expect(r.verdict).toBe('bad')
  })

  it('대기 중인 새 버전이 있으면 그렇게 알린다', () => {
    const r = swVerdict(facts({ hasWaiting: true }))
    expect(r.lines.join(' ')).toMatch(/새 버전/)
  })

  it('캐시가 여럿이면 옛 것이 남았다고 알린다', () => {
    const r = swVerdict(facts({ caches: ['aaa', 'bbb'] }))
    expect(r.verdict).toBe('warn')
    expect(r.lines.join(' ')).toMatch(/옛 캐시/)
  })

  it('등록됐는데 조종하지 않으면 경고다 — 첫 방문이면 정상이다', () => {
    const r = swVerdict(facts({ controlled: false }))
    expect(r.verdict).toBe('warn')
    expect(r.lines.join(' ')).toMatch(/새로고침/)
  })

  it('모든 판정에 사람이 읽을 문장이 있다', () => {
    const cases: Partial<SwFacts>[] = [
      {},
      { supported: false },
      { registered: false },
      { hasWaiting: true },
      { caches: [] },
      { caches: ['a', 'b', 'c'] },
    ]
    for (const c of cases) {
      const r = swVerdict(facts(c))
      expect(r.lines.length).toBeGreaterThan(0)
      expect(r.lines.every((l) => typeof l === 'string')).toBe(true)
    }
  })
})

describe('저장소 사용량', () => {
  it('바이트를 읽기 좋게 적는다', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('알 수 없으면 그렇게 적는다', () => {
    expect(formatBytes(undefined)).toBe('알 수 없음')
  })

  it('여유가 넉넉하면 정상이다', () => {
    expect(usageVerdict(1e6, 1e9).verdict).toBe('ok')
  })

  it('할당량의 대부분을 쓰면 경고다', () => {
    const r = usageVerdict(9.5e8, 1e9)
    expect(r.verdict).toBe('warn')
    expect(r.lines.join(' ')).toMatch(/거의 다/)
  })

  it('할당량을 모르면 경고 없이 알 수 없다고만 한다', () => {
    const r = usageVerdict(1e6, undefined)
    expect(r.verdict).toBe('warn')
    expect(r.lines.join(' ')).toMatch(/알 수 없/)
  })

  it('0으로 나누지 않는다', () => {
    expect(() => usageVerdict(0, 0)).not.toThrow()
  })
})

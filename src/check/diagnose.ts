export type Verdict = 'ok' | 'warn' | 'bad'

export interface Judged {
  verdict: Verdict
  lines: string[]
}

export interface SwFacts {
  supported: boolean
  registered: boolean
  hasActive: boolean
  hasWaiting: boolean
  controlled: boolean
  caches: string[]
}

const CACHE_PREFIX = 'lifelog-'

export function cacheVersionOf(names: string[]): string[] {
  return names
    .filter((n) => n.startsWith(CACHE_PREFIX))
    .map((n) => n.slice(CACHE_PREFIX.length))
}

export function swVerdict(facts: SwFacts): Judged {
  if (!facts.supported) {
    return {
      verdict: 'warn',
      lines: [
        '이 브라우저는 서비스워커를 지원하지 않습니다.',
        '오프라인 실행과 홈 화면 설치가 되지 않습니다.',
      ],
    }
  }

  const lines: string[] = []
  let verdict: Verdict = 'ok'

  lines.push(`등록: ${facts.registered ? '있음' : '없음'}`)
  lines.push(`활성: ${facts.hasActive ? '있음' : '없음'}`)
  lines.push(`이 페이지를 조종 중: ${facts.controlled ? '예' : '아니오'}`)
  lines.push(
    facts.caches.length === 0
      ? '캐시: 없음'
      : `캐시 ${facts.caches.length}개: ${facts.caches.join(', ')}`,
  )

  if (!facts.registered || !facts.hasActive) {
    verdict = 'bad'
    lines.push('', '서비스워커가 없어 오프라인에서 앱이 뜨지 않습니다.')
    return { verdict, lines }
  }

  if (facts.hasWaiting) {
    verdict = 'warn'
    lines.push('', '새 버전이 대기 중입니다. 앱을 완전히 닫았다 열면 적용됩니다.')
  }

  if (!facts.controlled) {
    verdict = 'warn'
    lines.push('', '아직 이 페이지를 조종하지 않습니다. 새로고침하면 잡힙니다.')
  }

  if (facts.caches.length > 1) {
    verdict = 'warn'
    lines.push('', '옛 캐시가 남아 있습니다. 새 버전이 활성화되면 정리됩니다.')
  }

  if (verdict === 'ok') lines.push('', '오프라인 실행 준비가 되어 있습니다.')
  return { verdict, lines }
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '알 수 없음'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

export function usageVerdict(usage: number | undefined, quota: number | undefined): Judged {
  const lines = [`쓰는 중: ${formatBytes(usage)}`, `할당량: ${formatBytes(quota)}`]

  if (quota === undefined || quota === 0 || usage === undefined) {
    return {
      verdict: 'warn',
      lines: [...lines, '', '남은 공간을 알 수 없습니다. 이 기기에서는 흔한 결과입니다.'],
    }
  }

  const ratio = usage / quota
  lines.push(`쓴 비율: ${(ratio * 100).toFixed(1)}%`)

  if (ratio >= 0.9) {
    return { verdict: 'warn', lines: [...lines, '', '할당량을 거의 다 썼습니다.'] }
  }
  return { verdict: 'ok', lines: [...lines, '', '여유가 있습니다.'] }
}

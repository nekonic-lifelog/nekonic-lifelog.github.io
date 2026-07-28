import { describe, expect, it } from 'vitest'
import type { Snapshot } from '../src/data/store'
import { parseBackup } from '../src/lib/backup'
import { toDueAt } from '../src/lib/due'
import {
  DEFAULT_OFFSETS,
  GRACE_MS,
  buildReminderFile,
  isoInZone,
  reminderPathFor,
  sameReminderFile,
  serializeReminderFile,
  type EventReminder,
  type RecurringReminder,
  type ReminderFile,
} from '../src/lib/reminders'
import { DEFAULT_SETTINGS, type Settings, type Todo } from '../src/lib/types'
import { makeTodo } from './factories'

const NOW = Date.parse('2026-03-12T20:00:00+09:00')
const OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/

function build(
  todos: Todo[],
  over: Partial<Settings> = {},
  now: number = NOW,
): ReminderFile {
  const settings: Settings = { ...DEFAULT_SETTINGS, ...over }
  const snapshot: Snapshot = {
    definitions: [],
    records: [],
    todos,
    projects: [],
    books: [],
    journal: [],
    settings,
  }
  return buildReminderFile({ snapshot, settings, now })
}

function only(file: ReminderFile): EventReminder {
  expect(file.events).toHaveLength(1)
  return file.events[0] as EventReminder
}

describe('이벤트 만들기', () => {
  it('마감이 있는 개인 할 일이 이벤트가 된다', () => {
    const todo = makeTodo({ title: '병원 예약', dueAt: '2026-08-03T14:00:00+09:00' })
    const event = only(build([todo]))

    expect(event.id).toBe(todo.id)
    expect(event.label).toBe('병원 예약')
    expect(event.offsets).toEqual(DEFAULT_OFFSETS)
    expect(event.channel).toBe('discord')
  })

  it('시각을 오프셋이 붙은 ISO8601로 낸다 — Z로 끝나지 않는다', () => {
    const event = only(build([makeTodo({ dueAt: '2026-08-03T14:00:00+09:00' })]))

    expect(event.at).toBe('2026-08-03T14:00:00+09:00')
    expect(event.at.endsWith('Z')).toBe(false)
    expect(OFFSET_RE.test(event.at)).toBe(true)
  })

  it('UTC로 적힌 마감도 설정 시간대의 벽시계로 옮겨 낸다', () => {
    const event = only(build([makeTodo({ dueAt: '2026-08-03T05:00:00.000Z' })]))
    expect(event.at).toBe('2026-08-03T14:00:00+09:00')
  })

  it('다른 시간대를 골라도 그 시간대의 오프셋을 붙인다', () => {
    const event = only(
      build([makeTodo({ dueAt: '2026-08-03T05:00:00.000Z' })], { tz: 'UTC' }),
    )
    expect(event.at).toBe('2026-08-03T05:00:00+00:00')
  })

  it('마감이 없는 할 일은 빠진다', () => {
    expect(build([makeTodo({ title: '언젠가' })]).events).toEqual([])
  })

  it('완료된 할 일은 빠진다', () => {
    const todo = makeTodo({ dueAt: '2026-08-03T14:00:00+09:00', status: 'done' })
    expect(build([todo]).events).toEqual([])
  })

  it('삭제된 할 일은 빠진다', () => {
    const todo = makeTodo({ dueAt: '2026-08-03T14:00:00+09:00', deleted: true })
    expect(build([todo]).events).toEqual([])
  })

  it('마감을 읽을 수 없으면 빠진다', () => {
    expect(build([makeTodo({ dueAt: '언젠가 그때쯤' })]).events).toEqual([])
  })

  it('시각이 이른 것부터 늘어놓는다', () => {
    const late = makeTodo({ id: 'a', dueAt: '2026-08-05T09:00:00+09:00' })
    const early = makeTodo({ id: 'b', dueAt: '2026-08-03T09:00:00+09:00' })
    expect(build([late, early]).events.map((e) => e.id)).toEqual(['b', 'a'])
  })
})

describe('마감 시각과 사전 알림', () => {
  const MINUTE_MS = 60_000

  function fireTimes(event: EventReminder, tz = 'Asia/Seoul'): string[] {
    const at = Date.parse(event.at)
    return event.offsets.map((minutes) => isoInZone(at - minutes * MINUTE_MS, tz))
  }

  it('오전 10시 마감에 60분 오프셋이면 09시에 알린다', () => {
    const todo = makeTodo({ dueAt: toDueAt('2026-08-03', '10:00') })
    const event = only(build([todo], { defaultOffsets: [60] }))

    expect(event.at).toBe('2026-08-03T10:00:00+09:00')
    expect(fireTimes(event)).toEqual(['2026-08-03T09:00:00+09:00'])
  })

  it('오프셋이 여러 개면 각각 제 시각을 갖는다', () => {
    const todo = makeTodo({ dueAt: toDueAt('2026-08-03', '14:00') })
    const event = only(build([todo], { defaultOffsets: [1440, 120, 60] }))

    expect(fireTimes(event)).toEqual([
      '2026-08-02T14:00:00+09:00',
      '2026-08-03T12:00:00+09:00',
      '2026-08-03T13:00:00+09:00',
    ])
  })

  it('같은 날 세 건이 각자 마감 시각을 기준으로 알린다', () => {
    const todos = [
      makeTodo({ id: 't-10', title: '오전 회의', dueAt: toDueAt('2026-08-03', '10:00') }),
      makeTodo({ id: 't-14', title: '치과', dueAt: toDueAt('2026-08-03', '14:00') }),
      makeTodo({ id: 't-17', title: '저녁 약속', dueAt: toDueAt('2026-08-03', '17:00') }),
    ]
    const file = build(todos, { defaultOffsets: [60] })

    expect(file.events.map((e) => e.at)).toEqual([
      '2026-08-03T10:00:00+09:00',
      '2026-08-03T14:00:00+09:00',
      '2026-08-03T17:00:00+09:00',
    ])
    expect(file.events.flatMap((e) => fireTimes(e))).toEqual([
      '2026-08-03T09:00:00+09:00',
      '2026-08-03T13:00:00+09:00',
      '2026-08-03T16:00:00+09:00',
    ])
  })

  it('시각을 비워 만든 마감만 정오로 간다', () => {
    const todo = makeTodo({ dueAt: toDueAt('2026-08-03') })
    expect(only(build([todo])).at).toBe('2026-08-03T12:00:00+09:00')
  })

  it('자정 마감이 앞날로 밀리지 않는다', () => {
    const todo = makeTodo({ dueAt: toDueAt('2026-08-03', '00:00') })
    expect(only(build([todo])).at).toBe('2026-08-03T00:00:00+09:00')
  })
})

describe('정리', () => {
  const due = '2026-03-10T14:00:00+09:00'
  const dueMs = Date.parse(due)

  it('경계 직전의 지난 이벤트는 남는다', () => {
    const todo = makeTodo({ dueAt: due })
    const file = build([todo], { defaultOffsets: [] }, dueMs + GRACE_MS - 1)
    expect(file.events).toHaveLength(1)
  })

  it('지난 지 하루가 된 이벤트는 빠진다', () => {
    const todo = makeTodo({ dueAt: due })
    const file = build([todo], { defaultOffsets: [] }, dueMs + GRACE_MS)
    expect(file.events).toEqual([])
  })

  it('마지막 오프셋 시각이 아직 여유 안에 있으면 남는다', () => {
    const todo = makeTodo({ dueAt: due })
    const last = dueMs - 60 * 60_000
    const file = build([todo], { defaultOffsets: [60] }, last + GRACE_MS - 1)
    expect(file.events).toHaveLength(1)
  })

  it('오프셋이 전부 소진되면 이벤트 시각이 덜 지났어도 빠진다', () => {
    const todo = makeTodo({ dueAt: due })
    const last = dueMs - 60 * 60_000
    const file = build([todo], { defaultOffsets: [60] }, last + GRACE_MS)

    expect(file.events).toEqual([])
    expect(last + GRACE_MS - dueMs).toBeLessThan(GRACE_MS)
  })

  it('아직 오지 않은 이벤트는 오프셋이 무엇이든 남는다', () => {
    const todo = makeTodo({ dueAt: '2027-01-01T09:00:00+09:00' })
    expect(build([todo], { defaultOffsets: [60] }).events).toHaveLength(1)
  })
})

describe('라벨 가리기', () => {
  const task = makeTodo({
    title: '3분기 매출 점검 회의',
    projectId: 'pj-1',
    dueAt: '2026-08-03T14:00:00+09:00',
  })

  it('프로젝트 작업 제목이 파일에 나타나지 않는다', () => {
    const file = build([task])
    expect(only(file).label).toBe('업무')
    expect(serializeReminderFile(file)).not.toContain('3분기 매출 점검 회의')
  })

  it('가리기를 끄면 프로젝트 작업 제목이 나타난다', () => {
    const file = build([task], { maskProjectLabels: false })
    expect(only(file).label).toBe('3분기 매출 점검 회의')
    expect(serializeReminderFile(file)).toContain('3분기 매출 점검 회의')
  })

  it('개인 할 일 제목은 가리기와 무관하게 나타난다', () => {
    const mine = makeTodo({ title: '치과 예약', dueAt: '2026-08-03T14:00:00+09:00' })
    const file = build([mine])
    expect(only(file).label).toBe('치과 예약')
    expect(serializeReminderFile(file)).toContain('치과 예약')
  })

  it('제목이 비어 있어도 라벨이 비지 않는다', () => {
    const blank = makeTodo({ title: '   ', dueAt: '2026-08-03T14:00:00+09:00' })
    expect(only(build([blank])).label).not.toBe('')
  })
})

describe('반복 알림', () => {
  const evening: RecurringReminder = {
    id: 'rec-1',
    at: '18:00',
    days: [1, 2, 3, 4, 5],
    label: '저녁 약',
    channel: 'discord',
  }

  it('설정에 적은 것이 그대로 나온다', () => {
    const file = build([], { recurring: [evening] })
    expect(file.recurring).toEqual([evening])
  })

  it('반복 알림은 offsets를 갖지 않는다', () => {
    const file = build([], { recurring: [evening] })
    expect(Object.keys(file.recurring[0] as RecurringReminder).sort()).toEqual(
      ['at', 'channel', 'days', 'id', 'label'].sort(),
    )
  })

  it('요일을 비우면 days 키 자체가 없다', () => {
    const daily: RecurringReminder = { ...evening, days: undefined }
    const file = build([], { recurring: [daily] })
    expect('days' in (file.recurring[0] as RecurringReminder)).toBe(false)
  })

  it('시각 형식이 아니면 버린다', () => {
    const broken: RecurringReminder = { ...evening, at: '오후 여섯 시' }
    expect(build([], { recurring: [broken] }).recurring).toEqual([])
  })

  it('요일 값은 0에서 6까지만 남기고 정렬한다', () => {
    const messy: RecurringReminder = { ...evening, days: [5, 1, 9, -2, 1] }
    expect((build([], { recurring: [messy] }).recurring[0] as RecurringReminder).days).toEqual([
      1, 5,
    ])
  })
})

describe('시간대와 채널', () => {
  it('기본 시간대는 서울이다', () => {
    expect(build([]).tz).toBe('Asia/Seoul')
  })

  it('알 수 없는 시간대는 기본값으로 되돌린다', () => {
    expect(build([], { tz: '어딘가' }).tz).toBe('Asia/Seoul')
  })

  it('채널 설정이 이벤트와 반복에 함께 실린다', () => {
    const file = build([makeTodo({ dueAt: '2026-08-03T14:00:00+09:00' })], {
      notifyChannel: 'email',
      recurring: [{ id: 'r', at: '07:00', label: '아침', channel: 'email' }],
    })
    expect(only(file).channel).toBe('email')
    expect((file.recurring[0] as RecurringReminder).channel).toBe('email')
  })

  it('오프셋 설정은 큰 것부터 정리해 담는다', () => {
    const file = build([makeTodo({ dueAt: '2027-01-01T09:00:00+09:00' })], {
      defaultOffsets: [60, 1440, 60, 0, -5],
    })
    expect(only(file).offsets).toEqual([1440, 60])
  })
})

describe('안정성', () => {
  const todos = [
    makeTodo({ id: 't-1', title: '치과', dueAt: '2026-08-03T14:00:00+09:00' }),
    makeTodo({ id: 't-2', title: '세금', dueAt: '2026-09-01T09:00:00+09:00' }),
  ]

  it('같은 스냅샷이면 같은 파일이 나온다', () => {
    expect(serializeReminderFile(build(todos))).toBe(serializeReminderFile(build(todos)))
  })

  it('id는 할 일의 id를 그대로 쓴다', () => {
    expect(build(todos).events.map((e) => e.id)).toEqual(['t-1', 't-2'])
  })

  it('할 일 순서가 뒤바뀌어도 같은 파일이 나온다', () => {
    expect(serializeReminderFile(build([...todos].reverse()))).toBe(
      serializeReminderFile(build(todos)),
    )
  })
})

describe('같은 파일 판정', () => {
  const file = (): ReminderFile => ({
    tz: 'Asia/Seoul',
    recurring: [{ id: 'r-1', at: '18:00', label: '저녁 약', channel: 'discord' }],
    events: [
      {
        id: 'e-1',
        at: '2026-08-03T14:00:00+09:00',
        label: '병원',
        offsets: [2880, 1440],
        channel: 'discord',
      },
    ],
  })

  it('내용이 같으면 같다고 본다', () => {
    expect(sameReminderFile(file(), file())).toBe(true)
  })

  it('키 순서가 달라도 같다고 본다', () => {
    const a = file()
    const b: ReminderFile = { events: a.events, recurring: a.recurring, tz: a.tz }
    expect(sameReminderFile(a, b)).toBe(true)
  })

  it('배열 순서가 달라도 같다고 본다', () => {
    const a = file()
    const b = file()
    const event = b.events[0] as EventReminder
    b.events = [{ ...event, offsets: [1440, 2880] }]
    expect(sameReminderFile(a, b)).toBe(true)
  })

  it('이벤트 순서가 달라도 같다고 본다', () => {
    const a = file()
    const second: EventReminder = { ...(a.events[0] as EventReminder), id: 'e-2' }
    const b = file()
    a.events = [a.events[0] as EventReminder, second]
    b.events = [second, b.events[0] as EventReminder]
    expect(sameReminderFile(a, b)).toBe(true)
  })

  it('라벨이 다르면 다르다고 본다', () => {
    const a = file()
    const b = file()
    b.events = [{ ...(b.events[0] as EventReminder), label: '다른 것' }]
    expect(sameReminderFile(a, b)).toBe(false)
  })

  it('반복 알림이 하나 늘면 다르다고 본다', () => {
    const a = file()
    const b = file()
    b.recurring = [...b.recurring, { id: 'r-2', at: '07:00', label: '아침', channel: 'discord' }]
    expect(sameReminderFile(a, b)).toBe(false)
  })

  it('시간대가 다르면 다르다고 본다', () => {
    expect(sameReminderFile(file(), { ...file(), tz: 'UTC' })).toBe(false)
  })
})

describe('스케줄러가 읽는 계약', () => {
  const file = build(
    [
      makeTodo({ id: 't-1', title: '병원 예약', dueAt: '2026-08-03T14:00:00+09:00' }),
      makeTodo({ id: 't-2', title: '보고서', projectId: 'pj-1', dueAt: '2026-08-04T09:00:00+09:00' }),
    ],
    { recurring: [{ id: 'r-1', at: '18:00', days: [1, 3], label: '저녁 약', channel: 'discord' }] },
  )

  it('세 열쇠만 갖는다', () => {
    expect(Object.keys(file).sort()).toEqual(['events', 'recurring', 'tz'])
  })

  it('JSON으로 적었다가 그대로 되읽을 수 있다', () => {
    const text = serializeReminderFile(file)
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(file)))
  })

  it('반복 항목이 요구된 필드를 갖춘다', () => {
    for (const item of file.recurring) {
      expect(typeof item.id).toBe('string')
      expect(/^([01]\d|2[0-3]):[0-5]\d$/.test(item.at)).toBe(true)
      expect(typeof item.label).toBe('string')
      expect(['discord', 'email']).toContain(item.channel)
      for (const day of item.days ?? []) expect(day).toBeGreaterThanOrEqual(0)
    }
  })

  it('이벤트 항목이 요구된 필드를 갖춘다', () => {
    expect(file.events).toHaveLength(2)
    for (const item of file.events) {
      expect(typeof item.id).toBe('string')
      expect(OFFSET_RE.test(item.at)).toBe(true)
      expect(typeof item.label).toBe('string')
      expect(item.offsets.every((m) => Number.isInteger(m) && m > 0)).toBe(true)
      expect(['discord', 'email']).toContain(item.channel)
    }
  })

  it('기기마다 자기 이름의 평문 파일 하나를 쓴다', () => {
    expect(reminderPathFor('phone')).toBe('meta/reminders/phone.json')
  })
})

describe('설정 하위 호환', () => {
  const old = () =>
    JSON.stringify({
      v: 1,
      exportedAt: '2026-03-12T11:00:00.000Z',
      data: { definitions: [], records: [], todos: [], settings: { dayBoundaryHour: 5 } },
    })

  it('알림 설정이 없는 옛 백업은 기본값으로 채운다', () => {
    const settings = parseBackup(old()).data.settings
    expect(settings.dayBoundaryHour).toBe(5)
    expect(settings.tz).toBe('Asia/Seoul')
    expect(settings.notifyChannel).toBe('discord')
    expect(settings.defaultOffsets).toEqual([2880, 1440, 120, 60])
    expect(settings.recurring).toEqual([])
    expect(settings.maskProjectLabels).toBe(true)
  })

  it('옛 백업으로도 알림 파일을 만들 수 있다', () => {
    const settings = parseBackup(old()).data.settings
    const snapshot: Snapshot = {
      definitions: [],
      records: [],
      todos: [makeTodo({ dueAt: '2026-08-03T14:00:00+09:00' })],
      projects: [],
      books: [],
      journal: [],
      settings,
    }
    const file = buildReminderFile({ snapshot, settings, now: NOW })
    expect(file.tz).toBe('Asia/Seoul')
    expect(file.events).toHaveLength(1)
  })

  it('저장된 알림 설정은 그대로 살아남는다', () => {
    const raw = JSON.stringify({
      v: 1,
      data: {
        definitions: [],
        records: [],
        todos: [],
        settings: { maskProjectLabels: false, tz: 'UTC' },
      },
    })
    const settings = parseBackup(raw).data.settings
    expect(settings.maskProjectLabels).toBe(false)
    expect(settings.tz).toBe('UTC')
    expect(settings.dayBoundaryHour).toBe(DEFAULT_SETTINGS.dayBoundaryHour)
  })
})

describe('장소와 메모는 알림 파일에 실리지 않는다', () => {
  const PLACE = '강남역 3번 출구'
  const NOTE = '보험증 챙기기'

  const withExtras = (over: Partial<Todo> = {}) =>
    makeTodo({
      title: '병원 예약',
      dueAt: '2026-08-03T14:00:00+09:00',
      place: PLACE,
      note: NOTE,
      ...over,
    })

  it('이벤트에 place와 note 키가 없다', () => {
    const event = only(build([withExtras()]))

    expect(Object.keys(event).sort()).toEqual(['at', 'channel', 'id', 'label', 'offsets'])
    expect((event as unknown as Record<string, unknown>)['place']).toBeUndefined()
    expect((event as unknown as Record<string, unknown>)['note']).toBeUndefined()
  })

  it('라벨에도 들어가지 않는다', () => {
    expect(only(build([withExtras()])).label).toBe('병원 예약')
  })

  it('직렬화한 글에 장소와 메모 문자열이 없다', () => {
    const text = serializeReminderFile(build([withExtras()]))

    expect(text).not.toContain(PLACE)
    expect(text).not.toContain(NOTE)
    expect(text).not.toContain('강남역')
    expect(text).not.toContain('보험증')
    expect(text).toContain('병원 예약')
  })

  it('제목을 가리는 프로젝트 작업에서도 새지 않는다', () => {
    const text = serializeReminderFile(
      build([withExtras({ projectId: 'p1', title: '계약서 검토' })]),
    )

    expect(text).not.toContain(PLACE)
    expect(text).not.toContain(NOTE)
    expect(text).not.toContain('계약서 검토')
    expect(text).toContain('업무')
  })

  it('가리지 않기로 해도 장소와 메모는 여전히 빠진다', () => {
    const text = serializeReminderFile(
      build([withExtras({ projectId: 'p1' })], { maskProjectLabels: false }),
    )

    expect(text).not.toContain(PLACE)
    expect(text).not.toContain(NOTE)
    expect(text).toContain('병원 예약')
  })

  it('두 파일이 같은지 볼 때도 장소와 메모는 셈에 들지 않는다', () => {
    const bare = build([makeTodo({ id: 't1', title: '병원 예약', dueAt: '2026-08-03T14:00:00+09:00' })])
    const rich = build([withExtras({ id: 't1' })])

    expect(sameReminderFile(bare, rich)).toBe(true)
  })
})

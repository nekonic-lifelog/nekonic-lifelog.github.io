// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Snapshot, Store, TableName } from '../src/data/store'
import { fixedClock } from '../src/lib/clock'
import {
  buildReminderFile,
  serializeReminderFile,
  type ReminderFile,
} from '../src/lib/reminders'
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/types'
import {
  ReminderSettings,
  type RemoteReminderEntry,
  type RemoteReminders,
} from '../src/screens/ReminderSettings'
import { AppProvider } from '../src/state/app'
import { makeTodo, resetIds } from './factories'

const NOW = '2026-03-12T20:00:00+09:00'
const DEVICE = 'phone'

interface Harness {
  settings(): Settings
  file(): ReminderFile
}

function snapshotOf(settings: Settings): Snapshot {
  return {
    definitions: [],
    records: [],
    todos: [
      makeTodo({
        id: 't-1',
        title: '보고서 마감',
        projectId: 'pj-1',
        place: '강남역 3번 출구',
        note: '보험증 챙기기',
        dueAt: '2026-08-03T14:00:00+09:00',
      }),
    ],
    projects: [],
    books: [],
    journal: [],
    settings,
  }
}

function harnessStore(over: Partial<Settings> = {}): Store & Harness {
  let settings: Settings = { ...DEFAULT_SETTINGS, ...over }
  return {
    deviceId: async () => DEVICE,
    adoptDeviceId: async () => undefined,
    loadAll: async () => snapshotOf(settings),
    put: async (_table: TableName, _rows: unknown[]) => undefined,
    putSettings: async (next: Settings) => {
      settings = next
    },
    replaceAll: async () => undefined,
    settings: () => settings,
    file: () =>
      buildReminderFile({
        snapshot: snapshotOf(settings),
        settings,
        now: Date.parse(NOW),
      }),
  }
}

function fakeRemote(entries: RemoteReminderEntry[]) {
  const written: { path: string; text: string }[] = []
  const held = [...entries]
  const api: RemoteReminders = {
    async list() {
      return held.map((e) => ({ ...e }))
    },
    async clear(entry) {
      written.push({
        path: entry.path,
        text: serializeReminderFile({ tz: entry.tz, recurring: [], events: [] }),
      })
    },
  }
  return { api, written, held }
}

function mount(store: Store, remote?: RemoteReminders) {
  return render(
    createElement(AppProvider, {
      store,
      clock: fixedClock(NOW),
      children: <ReminderSettings remote={remote} />,
    }),
  )
}

async function setTz(user: ReturnType<typeof userEvent.setup>, value: string) {
  const input = await screen.findByLabelText('시간대')
  await user.clear(input)
  await user.type(input, value)
  await user.click(screen.getByRole('button', { name: '시간대 저장' }))
}

beforeEach(resetIds)
afterEach(cleanup)

describe('알림 설정 — 시간대 고치기', () => {
  it('시간대를 바꾸면 만들어지는 알림 파일의 tz가 바뀐다', async () => {
    const user = userEvent.setup()
    const store = harnessStore()
    mount(store)

    expect(store.file().tz).toBe('Asia/Seoul')
    await setTz(user, 'America/New_York')

    expect(store.settings().tz).toBe('America/New_York')
    expect(store.file().tz).toBe('America/New_York')
  })

  it('시간대를 바꾸면 이벤트 시각의 오프셋도 따라 바뀐다', async () => {
    const user = userEvent.setup()
    const store = harnessStore()
    mount(store)

    expect(store.file().events[0]?.at).toBe('2026-08-03T14:00:00+09:00')
    await setTz(user, 'UTC')

    expect(store.file().events[0]?.at).toBe('2026-08-03T05:00:00+00:00')
  })

  it('잘못된 시간대는 저장되지 않는다', async () => {
    const user = userEvent.setup()
    const store = harnessStore()
    mount(store)

    await setTz(user, '어딘가')

    expect(store.settings().tz).toBe('Asia/Seoul')
    expect(store.file().tz).toBe('Asia/Seoul')
    expect(screen.getByText(/알 수 없는 시간대/)).toBeTruthy()
  })

  it('오프셋 표기도 저장되지 않는다', async () => {
    const user = userEvent.setup()
    const store = harnessStore()
    mount(store)

    await setTz(user, '+09:00')

    expect(store.settings().tz).toBe('Asia/Seoul')
    expect(screen.getByText(/알 수 없는 시간대/)).toBeTruthy()
  })

  it('시간대를 고쳐도 알림 파일 형식은 그대로다', async () => {
    const user = userEvent.setup()
    const store = harnessStore()
    mount(store)

    await setTz(user, 'Europe/Paris')
    const file = store.file()

    expect(Object.keys(file).sort()).toEqual(['events', 'recurring', 'tz'])
    expect(Object.keys(file.events[0] ?? {}).sort()).toEqual([
      'at',
      'channel',
      'id',
      'label',
      'offsets',
    ])
  })

  it('시간대 입력에 지금 값이 미리 들어 있다', async () => {
    mount(harnessStore({ tz: 'Europe/Berlin' }))

    const input = (await screen.findByDisplayValue('Europe/Berlin')) as HTMLInputElement
    expect(input.getAttribute('aria-label')).toBe('시간대')
  })
})

describe('알림 설정 — 채널 고치기', () => {
  it('채널을 바꾸면 알림 파일의 채널이 바뀐다', async () => {
    const user = userEvent.setup()
    const store = harnessStore()
    mount(store)

    await user.click(await screen.findByRole('button', { name: '메일' }))

    expect(store.settings().notifyChannel).toBe('email')
    expect(store.file().events[0]?.channel).toBe('email')
  })

  it('채널을 바꾸면 이미 만든 반복 알림도 함께 옮긴다', async () => {
    const user = userEvent.setup()
    const store = harnessStore({
      recurring: [{ id: 'r-1', at: '18:00', label: '저녁 약', channel: 'discord' }],
    })
    mount(store)

    await user.click(await screen.findByRole('button', { name: '메일' }))

    expect(store.file().recurring[0]?.channel).toBe('email')
  })

  it('지금 채널이 눌린 채로 보인다', async () => {
    mount(harnessStore({ notifyChannel: 'email' }))

    expect(
      (await screen.findByRole('button', { name: '메일' })).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen.getByRole('button', { name: '디스코드' }).getAttribute('aria-pressed'),
    ).toBe('false')
  })
})

describe('알림 설정 — 이 기기의 설정임을 알린다', () => {
  it('다른 기기에는 따로 켜야 한다고 알린다', async () => {
    mount(harnessStore())

    expect(await screen.findByText(/다른 기기에서는 따로/)).toBeTruthy()
  })

  it('가림이 꺼져 있으면 경고가 보인다', async () => {
    const { container } = mount(harnessStore({ maskProjectLabels: false }))

    const warn = await screen.findByRole('alert')
    expect(warn.textContent).toMatch(/가리지 않고/)
    expect(container.querySelector('.rem-warn')).toBeTruthy()
  })

  it('가림이 켜져 있으면 경고가 없다', async () => {
    mount(harnessStore())

    await screen.findByLabelText('시간대')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('가리기를 끄면 그 자리에서 경고가 뜬다', async () => {
    const user = userEvent.setup()
    mount(harnessStore())

    await user.click(await screen.findByRole('button', { name: '프로젝트 작업 제목 가림' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})

describe('알림 설정 — 좀비 알림 파일 비우기', () => {
  const entries: RemoteReminderEntry[] = [
    { deviceId: 'phone', path: 'meta/reminders/phone.json', tz: 'Asia/Seoul' },
    { deviceId: '옛-아이폰', path: 'meta/reminders/옛-아이폰.json', tz: 'Europe/Paris' },
  ]

  async function open(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: '원격에서 불러오기' }))
  }

  function rowOf(deviceId: string): HTMLElement {
    return screen.getByText(deviceId).closest('.rem-file') as HTMLElement
  }

  it('불러오기 전에는 원격을 건드리지 않는다', async () => {
    const remote = fakeRemote(entries)
    mount(harnessStore(), remote.api)

    expect(await screen.findByRole('button', { name: '원격에서 불러오기' })).toBeTruthy()
    expect(screen.queryByText('옛-아이폰')).toBeNull()
  })

  it('원격의 알림 파일을 늘어놓고 이 기기를 구분해 보여준다', async () => {
    const user = userEvent.setup()
    const remote = fakeRemote(entries)
    mount(harnessStore(), remote.api)

    await open(user)

    expect(within(rowOf('phone')).getByText('이 기기')).toBeTruthy()
    expect(within(rowOf('옛-아이폰')).queryByText('이 기기')).toBeNull()
  })

  it('다른 기기 파일을 비우면 빈 목록으로 덮어쓴다 — 지우지 않는다', async () => {
    const user = userEvent.setup()
    const remote = fakeRemote(entries)
    mount(harnessStore(), remote.api)

    await open(user)
    await user.click(within(rowOf('옛-아이폰')).getByRole('button', { name: '비우기' }))
    await user.click(screen.getByRole('button', { name: '비우기 확인' }))

    expect(remote.written).toHaveLength(1)
    const wrote = remote.written[0]!
    expect(wrote.path).toBe('meta/reminders/옛-아이폰.json')
    expect(JSON.parse(wrote.text)).toEqual({
      tz: 'Europe/Paris',
      recurring: [],
      events: [],
    })
  })

  it('비운 파일의 tz는 남는다', async () => {
    const user = userEvent.setup()
    const remote = fakeRemote(entries)
    mount(harnessStore(), remote.api)

    await open(user)
    await user.click(within(rowOf('옛-아이폰')).getByRole('button', { name: '비우기' }))
    await user.click(screen.getByRole('button', { name: '비우기 확인' }))

    expect((JSON.parse(remote.written[0]!.text) as ReminderFile).tz).toBe('Europe/Paris')
  })

  it('비운 파일 형식이 그대로다 — 세 열쇠뿐이다', async () => {
    const user = userEvent.setup()
    const remote = fakeRemote(entries)
    mount(harnessStore(), remote.api)

    await open(user)
    await user.click(within(rowOf('옛-아이폰')).getByRole('button', { name: '비우기' }))
    await user.click(screen.getByRole('button', { name: '비우기 확인' }))

    const text = remote.written[0]!.text
    expect(Object.keys(JSON.parse(text) as object).sort()).toEqual([
      'events',
      'recurring',
      'tz',
    ])
    expect(text.endsWith('\n')).toBe(true)
  })

  it('비운 파일에 본문·장소·메모가 실리지 않는다', async () => {
    const user = userEvent.setup()
    const remote = fakeRemote(entries)
    mount(harnessStore({ maskProjectLabels: false }), remote.api)

    await open(user)
    await user.click(within(rowOf('옛-아이폰')).getByRole('button', { name: '비우기' }))
    await user.click(screen.getByRole('button', { name: '비우기 확인' }))

    const text = remote.written[0]!.text
    expect(text).not.toContain('보고서 마감')
    expect(text).not.toContain('강남역')
    expect(text).not.toContain('보험증')
  })

  it('지금 이 기기 파일을 비우려면 확인을 거친다', async () => {
    const user = userEvent.setup()
    const remote = fakeRemote(entries)
    mount(harnessStore(), remote.api)

    await open(user)
    await user.click(within(rowOf('phone')).getByRole('button', { name: '비우기' }))
    expect(remote.written).toHaveLength(0)
    expect(screen.getByText(/지금 쓰는 이 기기/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '비우기 확인' }))
    expect(remote.written).toHaveLength(1)
    expect(remote.written[0]!.path).toBe('meta/reminders/phone.json')
  })

  it('확인을 취소하면 비우지 않는다', async () => {
    const user = userEvent.setup()
    const remote = fakeRemote(entries)
    mount(harnessStore(), remote.api)

    await open(user)
    await user.click(within(rowOf('phone')).getByRole('button', { name: '비우기' }))
    await user.click(screen.getByRole('button', { name: '그만두기' }))

    expect(remote.written).toHaveLength(0)
    expect(screen.queryByRole('button', { name: '비우기 확인' })).toBeNull()
  })

  it('원격을 읽지 못하면 까닭을 보여준다', async () => {
    const user = userEvent.setup()
    const broken: RemoteReminders = {
      async list() {
        throw new Error('이 기기가 아직 저장소에 이어져 있지 않습니다.')
      },
      async clear() {
        throw new Error('쓸 수 없습니다.')
      },
    }
    mount(harnessStore(), broken)

    await open(user)

    expect(await screen.findByText(/이어져 있지 않습니다/)).toBeTruthy()
  })

  it('원격에 알림 파일이 없으면 비었다고 말한다', async () => {
    const user = userEvent.setup()
    const remote = fakeRemote([])
    mount(harnessStore(), remote.api)

    await open(user)

    expect(await screen.findByText(/올라간 알림 파일이 없습니다/)).toBeTruthy()
  })
})

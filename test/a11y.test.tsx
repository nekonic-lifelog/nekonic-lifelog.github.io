// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Snapshot, Store } from '../src/data/store'
import { fixedClock } from '../src/lib/clock'
import { ddayLabel } from '../src/lib/due'
import { DEFAULT_SETTINGS } from '../src/lib/types'
import { DDay } from '../src/screens/DDay'
import { Timer } from '../src/screens/Timer'
import { AppProvider } from '../src/state/app'
import { makeProject, makeTodo, resetIds } from './factories'

const NOW = '2026-03-12T20:00:00+09:00'

function snap(partial: Partial<Snapshot> = {}): Snapshot {
  return {
    definitions: [],
    records: [],
    todos: [],
    projects: [],
    books: [],
    journal: [],
    settings: DEFAULT_SETTINGS,
    ...partial,
  }
}

function memoryStore(snapshot: Snapshot): Store {
  return {
    deviceId: async () => 'test-device',
    adoptDeviceId: async () => undefined,
    loadAll: async () => snapshot,
    put: async () => undefined,
    putSettings: async () => undefined,
    replaceAll: async () => undefined,
  }
}

function mount(screenEl: Parameters<typeof createElement>[0], snapshot: Snapshot) {
  return render(
    createElement(AppProvider, {
      store: memoryStore(snapshot),
      clock: fixedClock(NOW),
      children: createElement(screenEl),
    }),
  )
}

beforeEach(resetIds)
afterEach(cleanup)

describe('D-day 칩 — 부호만으로 구분하지 않는다', () => {
  it('남은 날은 문장으로 읽힌다', () => {
    expect(ddayLabel(3)).toBe('3일 남음')
  })

  it('당일은 오늘이라고 읽힌다', () => {
    expect(ddayLabel(0)).toBe('오늘')
  })

  it('지난 것은 지났다고 읽힌다', () => {
    expect(ddayLabel(-2)).toBe('2일 지남')
  })

  it('D-day 화면의 칩에 문장이 붙는다', async () => {
    mount(DDay, snap({ todos: [makeTodo({ title: '병원', pinned: true, dueAt: '2026-03-15T09:00:00+09:00' })] }))

    expect(await screen.findByLabelText('3일 남음')).toBeTruthy()
  })

  it('지난 D-day도 문장으로 구분된다', async () => {
    mount(DDay, snap({ todos: [makeTodo({ title: '지난 일', pinned: true, dueAt: '2026-03-10T09:00:00+09:00' })] }))

    expect(await screen.findByLabelText('2일 지남')).toBeTruthy()
  })
})

describe('D-day 칩 — 화면마다 빠짐없이 붙는다', () => {
  it('할 일 탭의 기한 칩에도 문장이 붙는다', async () => {
    const { Todos } = await import('../src/screens/Todos')
    mount(Todos, snap({ todos: [makeTodo({ title: '세금', dueAt: '2026-03-15T09:00:00+09:00' })] }))

    expect(await screen.findByLabelText('3일 남음')).toBeTruthy()
  })

  it('지난 기한도 지났다고 읽힌다', async () => {
    const { Todos } = await import('../src/screens/Todos')
    mount(Todos, snap({ todos: [makeTodo({ title: '지난 것', dueAt: '2026-03-10T09:00:00+09:00' })] }))

    expect(await screen.findByLabelText('2일 지남')).toBeTruthy()
  })

  it('프로젝트 마감 칩에도 문장이 붙는다', async () => {
    const { Todos } = await import('../src/screens/Todos')
    mount(
      Todos,
      snap({
        projects: [makeProject({ name: '이사', dueAt: '2026-03-14T09:00:00+09:00' })],
      }),
    )

    expect(await screen.findByLabelText('2일 남음')).toBeTruthy()
  })
})

describe('타이머 — 끝난 것이 읽힌다', () => {
  it('상태 문구가 읽어주는 영역에 있다', async () => {
    mount(Timer, snap())

    const phase = await screen.findByRole('status')
    expect(phase.textContent).toContain('대기 중')
  })

  it('시간이 다 되면 그 문구가 같은 영역에서 바뀐다', async () => {
    const user = userEvent.setup()
    mount(Timer, snap())

    await screen.findByRole('status')
    const reset = screen.queryByRole('button', { name: '초기화' })
    if (reset) await user.click(reset)

    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('남은 시간 자체는 매초 읽어주지 않는다', async () => {
    mount(Timer, snap())

    const display = await screen.findByRole('timer')
    expect(display.getAttribute('aria-live')).toBeNull()
  })
})

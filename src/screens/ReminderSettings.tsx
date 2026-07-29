import { useEffect, useMemo, useState } from 'react'
import { weekdayLabel } from '../lib/day'
import { newId } from '../lib/ids'
import {
  DEFAULT_TZ,
  REMINDER_DIR,
  emptyReminderFile,
  isKnownTimeZone,
  listTimeZones,
  readReminderTz,
  reminderDeviceIdFrom,
  serializeReminderFile,
  type ReminderChannel,
  type RecurringReminder,
} from '../lib/reminders'
import { GithubRepo } from '../remote/github'
import { idbCredentials } from '../sync/credentials'
import { useApp } from '../state/app'
import '../styles/reminders.css'

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]
const TZ_LIST_ID = 'rem-tz-options'
const CLEAR_MESSAGE = '알림 파일 비우기'

const OFFSET_CHOICES: { minutes: number; label: string }[] = [
  { minutes: 2880, label: '48시간 전' },
  { minutes: 1440, label: '24시간 전' },
  { minutes: 120, label: '2시간 전' },
  { minutes: 60, label: '1시간 전' },
]

const CHANNEL_CHOICES: { value: ReminderChannel; label: string }[] = [
  { value: 'discord', label: '디스코드' },
  { value: 'email', label: '메일' },
]

export interface RemoteReminderEntry {
  deviceId: string
  path: string
  tz: string
}

export interface RemoteReminders {
  list(): Promise<RemoteReminderEntry[]>
  clear(entry: RemoteReminderEntry): Promise<void>
}

export interface ReminderSettingsProps {
  remote?: RemoteReminders | undefined
}

function daysLabel(days: number[] | undefined): string {
  if (!days || days.length === 0 || days.length === 7) return '매일'
  return `${days.map(weekdayLabel).join('·')}요일`
}

function reason(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return '알 수 없는 문제가 생겼습니다.'
}

async function openRepo(): Promise<GithubRepo> {
  const creds = await idbCredentials().load()
  if (creds === null) {
    throw new Error('이 기기가 아직 저장소에 이어져 있지 않습니다. 먼저 동기화를 켜세요.')
  }
  return new GithubRepo({ ...creds.remote }, creds.token)
}

export function githubReminderFiles(): RemoteReminders {
  return {
    async list() {
      const repo = await openRepo()
      const head = await repo.readHead()
      let paths = head.tree.entries.map((entry) => entry.path)
      if (head.tree.truncated && head.commitSha !== '') {
        const sub = await repo.readTree(`${head.commitSha}:${REMINDER_DIR}`)
        paths = sub.entries.map((entry) => `${REMINDER_DIR}/${entry.path}`)
      }
      const out: RemoteReminderEntry[] = []
      for (const path of paths) {
        const deviceId = reminderDeviceIdFrom(path)
        if (deviceId === null) continue
        const text = await repo.readTextFile(path)
        out.push({ deviceId, path, tz: text === null ? DEFAULT_TZ : readReminderTz(text) })
      }
      out.sort((a, b) => (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0))
      return out
    },

    async clear(entry) {
      const repo = await openRepo()
      const bytes = new TextEncoder().encode(
        serializeReminderFile(emptyReminderFile(entry.tz)),
      )
      await repo.commitWithRetry(async () => ({
        message: CLEAR_MESSAGE,
        put: [{ path: entry.path, content: bytes }],
      }))
    },
  }
}

export function ReminderSettings(props: ReminderSettingsProps) {
  const app = useApp()
  const settings = app.snapshot.settings
  const recurring = settings.recurring ?? []
  const offsets = settings.defaultOffsets ?? []
  const masked = settings.maskProjectLabels !== false
  const channel = settings.notifyChannel ?? 'discord'

  const toggleOffset = (minutes: number) => {
    const next = offsets.includes(minutes)
      ? offsets.filter((m) => m !== minutes)
      : [...offsets, minutes].sort((a, b) => b - a)
    void app.saveSettings({ defaultOffsets: next })
  }

  const addRecurring = (made: RecurringReminder) => {
    void app.saveSettings({ recurring: [...recurring, made] })
  }

  const removeRecurring = (id: string) => {
    void app.saveSettings({ recurring: recurring.filter((r) => r.id !== id) })
  }

  const pickChannel = (next: ReminderChannel) => {
    if (next === channel) return
    void app.saveSettings({
      notifyChannel: next,
      recurring: recurring.map((r) => ({ ...r, channel: next })),
    })
  }

  return (
    <>
      <section className="card">
        <div className="card__head">
          <h2>알림</h2>
          <span className="badge">{settings.tz || DEFAULT_TZ}</span>
        </div>

        <p className="rem-note">
          여기는 <strong>이 기기의</strong> 알림 설정입니다. 설정은 기기끼리 동기화되지
          않으니, 다른 기기에서는 따로 켜야 합니다.
        </p>

        <p className="hint">
          알림 목록은 <strong>암호화하지 않고 평문으로</strong> 저장소에 올라갑니다. 회의
          제목처럼 남이 보면 곤란한 말은 라벨에 적지 마세요.
        </p>

        <TimeZoneField />

        <fieldset className="weekdays">
          <legend>알림 채널</legend>
          {CHANNEL_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className={choice.value === channel ? 'chip chip--on' : 'chip'}
              aria-pressed={choice.value === channel}
              onClick={() => pickChannel(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        </fieldset>
        <p className="hint">
          채널을 바꾸면 이미 만들어 둔 반복 알림도 함께 옮깁니다.
        </p>

        {recurring.length === 0 ? (
          <p className="empty">반복 알림이 없습니다.</p>
        ) : (
          recurring.map((item) => (
            <div key={item.id} className="field">
              <span className="badge">{item.at}</span>
              <span>{item.label}</span>
              <span className="hint">{daysLabel(item.days)}</span>
              <button
                type="button"
                className="icon-btn icon-btn--danger"
                onClick={() => removeRecurring(item.id)}
                aria-label={`${item.label} 알림 삭제`}
              >
                ×
              </button>
            </div>
          ))
        )}

        <RecurringComposer onAdd={addRecurring} />

        <fieldset className="weekdays">
          <legend>기본 사전 알림</legend>
          {OFFSET_CHOICES.map((choice) => (
            <button
              key={choice.minutes}
              type="button"
              className={offsets.includes(choice.minutes) ? 'chip chip--on' : 'chip'}
              aria-pressed={offsets.includes(choice.minutes)}
              onClick={() => toggleOffset(choice.minutes)}
            >
              {choice.label}
            </button>
          ))}
        </fieldset>
        <p className="hint">마감이 있는 할 일에 이 시각들로 미리 알립니다.</p>

        <div className="btn-row">
          <button
            type="button"
            aria-pressed={masked}
            onClick={() => void app.saveSettings({ maskProjectLabels: !masked })}
          >
            {masked ? '프로젝트 작업 제목 가림' : '프로젝트 작업 제목 그대로'}
          </button>
        </div>
        <p className="hint">
          가리면 프로젝트에 속한 작업은 제목 대신 &quot;업무&quot;로만 나갑니다. 개인 할 일은
          제목 그대로 나갑니다.
        </p>
        {!masked && (
          <p className="rem-warn" role="alert">
            지금 이 기기는 프로젝트 작업 제목을 <strong>가리지 않고</strong> 평문으로
            올립니다. 다른 기기에서 가리기를 켜 두었어도 이 기기가 올리는 파일에는 그대로
            실립니다.
          </p>
        )}
      </section>

      <RemoteReminderFiles remote={props.remote} deviceId={app.deviceId} />
    </>
  )
}

function TimeZoneField() {
  const app = useApp()
  const saved = app.snapshot.settings.tz || DEFAULT_TZ
  const [draft, setDraft] = useState(saved)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const zones = useMemo(listTimeZones, [])

  useEffect(() => {
    setDraft(saved)
  }, [saved])

  const submit = () => {
    const next = draft.trim()
    if (!isKnownTimeZone(next)) {
      setDone(false)
      setError(
        `알 수 없는 시간대입니다. ${DEFAULT_TZ}처럼 지역/도시 꼴의 IANA 이름을 적으세요.`,
      )
      return
    }
    setError(null)
    setDone(true)
    void app.saveSettings({ tz: next })
  }

  return (
    <form
      className="rem-tz"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <label className="rem-field">
        <span>시간대</span>
        <input
          type="text"
          value={draft}
          list={zones.length > 0 ? TZ_LIST_ID : undefined}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value)
            setError(null)
            setDone(false)
          }}
          aria-label="시간대"
        />
      </label>
      {zones.length > 0 && (
        <datalist id={TZ_LIST_ID}>
          {zones.map((tz) => (
            <option key={tz} value={tz} />
          ))}
        </datalist>
      )}
      <div className="btn-row">
        <button type="submit">시간대 저장</button>
        <button
          type="button"
          aria-label={`기본 시간대 ${DEFAULT_TZ}로 되돌리기`}
          onClick={() => setDraft(DEFAULT_TZ)}
        >
          기본값으로
        </button>
      </div>
      <p className="hint">
        반복 알림 시각을 이 시간대의 벽시계로 읽습니다. 여행 중이라 시각이 어긋나면 여기서
        고치세요.
      </p>
      {error && <p className="msg msg--error">{error}</p>}
      {done && !error && <p className="msg msg--ok">시간대를 바꿨습니다.</p>}
    </form>
  )
}

function RemoteReminderFiles({
  remote,
  deviceId,
}: {
  remote: RemoteReminders | undefined
  deviceId: string
}) {
  const port = useMemo(() => remote ?? githubReminderFiles(), [remote])
  const [rows, setRows] = useState<RemoteReminderEntry[] | null>(null)
  const [asking, setAsking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const load = async () => {
    setBusy(true)
    setError(null)
    try {
      setRows(await port.list())
    } catch (err) {
      setError(reason(err))
    } finally {
      setBusy(false)
    }
  }

  const clear = async (entry: RemoteReminderEntry) => {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await port.clear(entry)
      setAsking(null)
      setDone(`${entry.deviceId} 알림 파일을 비웠습니다.`)
      setRows(await port.list())
    } catch (err) {
      setError(reason(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card__head">
        <h2>원격의 알림 파일</h2>
        <span className="badge">기기별 한 개</span>
      </div>
      <p className="hint">
        기기를 바꾸거나 저장 공간이 지워져 기기 ID가 새로 발급되면, 원격에 남은 옛 기기의
        알림 파일이 그대로 알림을 계속 보냅니다. 여기서 그 파일을 빈 목록으로 덮어 멈추세요.
        파일 자체를 지우지는 않습니다.
      </p>

      <div className="btn-row">
        <button type="button" disabled={busy} onClick={() => void load()}>
          {busy ? '읽는 중…' : '원격에서 불러오기'}
        </button>
      </div>

      {rows !== null &&
        (rows.length === 0 ? (
          <p className="empty">원격에 올라간 알림 파일이 없습니다.</p>
        ) : (
          <ul className="rem-files">
            {rows.map((entry) => (
              <li key={entry.path} className="rem-file">
                <div className="rem-file__head">
                  <code className="rem-file__id">{entry.deviceId}</code>
                  {entry.deviceId === deviceId && <span className="badge">이 기기</span>}
                  <span className="hint">{entry.tz}</span>
                </div>
                {asking === entry.path ? (
                  <div className="rem-file__ask">
                    <p className={entry.deviceId === deviceId ? 'rem-warn' : 'hint'}>
                      {entry.deviceId === deviceId
                        ? '지금 쓰는 이 기기의 파일입니다. 비우면 다음에 바뀐 것이 올라갈 때까지 이 기기 알림이 오지 않습니다.'
                        : '이 기기 이름으로는 더 이상 알림이 가지 않습니다.'}
                    </p>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="danger"
                        disabled={busy}
                        onClick={() => void clear(entry)}
                      >
                        비우기 확인
                      </button>
                      <button type="button" onClick={() => setAsking(null)}>
                        그만두기
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="btn-row">
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        setDone(null)
                        setAsking(entry.path)
                      }}
                    >
                      비우기
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ))}

      {done && <p className="msg msg--ok">{done}</p>}
      {error && <p className="msg msg--error">{error}</p>}
    </section>
  )
}

function RecurringComposer({ onAdd }: { onAdd(made: RecurringReminder): void }) {
  const app = useApp()
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState('')
  const [label, setLabel] = useState('')
  const [days, setDays] = useState<number[]>([])

  const reset = () => {
    setAt('')
    setLabel('')
    setDays([])
    setOpen(false)
  }

  const submit = () => {
    if (!at || !label.trim()) return
    const made: RecurringReminder = {
      id: newId(),
      at,
      label: label.trim(),
      channel: app.snapshot.settings.notifyChannel ?? 'discord',
    }
    onAdd(days.length > 0 && days.length < 7 ? { ...made, days: [...days].sort() } : made)
    reset()
  }

  if (!open) {
    return (
      <button type="button" className="link-btn" onClick={() => setOpen(true)}>
        + 반복 알림
      </button>
    )
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <label className="field">
        <span>시각</span>
        <input
          type="time"
          value={at}
          onChange={(e) => setAt(e.target.value)}
          aria-label="반복 알림 시각"
        />
      </label>
      <input
        type="text"
        value={label}
        placeholder="라벨 (예: 저녁 약)"
        onChange={(e) => setLabel(e.target.value)}
        aria-label="반복 알림 라벨"
      />
      <fieldset className="weekdays">
        <legend>요일 (비우면 매일)</legend>
        {WEEKDAYS.map((d) => (
          <button
            key={d}
            type="button"
            className={days.includes(d) ? 'wd wd--on' : 'wd'}
            aria-pressed={days.includes(d)}
            onClick={() =>
              setDays((prev) =>
                prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
              )
            }
          >
            {weekdayLabel(d)}
          </button>
        ))}
      </fieldset>
      <div className="btn-row">
        <button type="submit" disabled={!at || !label.trim()}>
          반복 알림 추가
        </button>
        <button type="button" onClick={reset}>
          닫기
        </button>
      </div>
    </form>
  )
}

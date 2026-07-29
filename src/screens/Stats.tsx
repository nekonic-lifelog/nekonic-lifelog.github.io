import { useMemo, useState } from 'react'
import {
  habitStats,
  journalStats,
  measureStats,
  rangeFor,
  readingStats,
  summaryFor,
  type HabitStat,
  type MeasureStat,
  type Period,
} from '../lib/stats'
import { useApp } from '../state/app'
import '../styles/stats.css'

const PERIODS: [Period, string][] = [
  ['week', '주'],
  ['month', '월'],
  ['year', '연'],
]

export function Stats() {
  const app = useApp()
  const [period, setPeriod] = useState<Period>('week')

  const range = useMemo(() => rangeFor(period, app.today), [period, app.today])
  const opts = useMemo(
    () => ({ boundaryHour: app.boundaryHour, clock: app.clock }),
    [app.boundaryHour, app.clock],
  )
  const stats = useMemo(
    () => habitStats(app.snapshot, range, opts),
    [app.snapshot, range, opts],
  )
  const summary = useMemo(() => summaryFor(stats), [stats])
  const journal = useMemo(
    () => journalStats(app.snapshot, range, app.boundaryHour),
    [app.snapshot, range, app.boundaryHour],
  )
  const reading = useMemo(
    () => readingStats(app.snapshot, range, app.boundaryHour),
    [app.snapshot, range, app.boundaryHour],
  )

  const measures = useMemo(
    () => measureStats(app.snapshot, range, opts),
    [app.snapshot, range, opts],
  )

  const nothingLogged =
    journal.entries === 0 && reading.sessions === 0 && reading.finishedBooks === 0

  return (
    <div className="screen">
      <h1 className="screen__title">통계</h1>

      <div className="btn-row stat-tabs" role="group" aria-label="기간 선택">
        {PERIODS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={value === period ? 'tab tab--on' : 'tab'}
            aria-pressed={value === period}
            onClick={() => setPeriod(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="hint stat-range">{`${range.from} ~ ${range.to}`}</p>

      <div className="stat-summary">
        <section className="card stat-figure">
          <h2>기간 달성률</h2>
          <strong className="stat-figure__value">
            {`${Math.round(summary.achievedPercent)}%`}
          </strong>
          <span className="stat-figure__sub">
            {`대상 ${summary.totalTargetDays}일 중 ${summary.totalAchievedDays}일`}
          </span>
        </section>
        <section className="card stat-figure">
          <h2>최장 스트릭</h2>
          <strong className="stat-figure__value">{`${summary.longestStreak}일`}</strong>
          <span className="stat-figure__sub">기간 안에서 가장 길게 이어진 날</span>
        </section>
      </div>

      <section className="card">
        <div className="card__head">
          <h2>습관</h2>
          {stats.length > 0 && <span className="badge">{`${stats.length}개`}</span>}
        </div>
        {stats.length === 0 ? (
          <p className="empty">
            표시할 습관이 없습니다. 설정에서 추적할 것을 하나 만들어 보세요.
          </p>
        ) : (
          <ul className="stat-bars">
            {stats.map((stat) => (
              <StatBar key={stat.definition.id} stat={stat} />
            ))}
          </ul>
        )}
      </section>

      {measures.length > 0 && <MeasureCard measures={measures} />}

      <section className="card">
        <div className="card__head">
          <h2>기록</h2>
        </div>
        {nothingLogged ? (
          <p className="empty">이 기간에 남긴 기록이 없습니다.</p>
        ) : (
          <>
            <ul className="stat-facts">
              <li className="stat-fact">
                <span className="stat-fact__value">{`${journal.diaryDays}일`}</span>
                <span className="stat-fact__label">일기 쓴 날</span>
              </li>
              <li className="stat-fact">
                <span className="stat-fact__value">{`${reading.pagesRead}쪽`}</span>
                <span className="stat-fact__label">읽은 페이지</span>
              </li>
              <li className="stat-fact">
                <span className="stat-fact__value">{`${reading.finishedBooks}권`}</span>
                <span className="stat-fact__label">완독</span>
              </li>
            </ul>

            {reading.byBook.length > 0 && (
              <ul className="stat-books">
                {reading.byBook.map(({ book, pages }) => (
                  <li key={book.id} className="stat-book">
                    <span className="stat-book__title">{book.title}</span>
                    <span className="stat-book__pages">{`${pages}쪽`}</span>
                  </li>
                ))}
              </ul>
            )}

            <p className="hint">
              {`일기 ${journal.byKind.diary}건 · 회의록 ${journal.byKind.meeting}건 · 메모 ${journal.byKind.memo}건 · 독서 ${reading.sessions}회`}
            </p>
          </>
        )}
      </section>
    </div>
  )
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function MeasureCard({ measures }: { measures: MeasureStat[] }) {
  const [open, setOpen] = useState(false)
  const [shifted, setShifted] = useState(false)

  return (
    <section className="card">
      <div className="card__head">
        <h2>기록 지표</h2>
        <span className="badge">{`${measures.length}개`}</span>
      </div>

      <ul className="measures">
        {measures.map((measure) => (
          <MeasureRow key={measure.definition.id} measure={measure} />
        ))}
      </ul>

      {measures.length > 1 && (
        <div className="measure-overlay">
          <button
            type="button"
            className="link-btn"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            겹쳐 보기
          </button>

          {open && (
            <Overlay
              measures={measures}
              shifted={shifted}
              onShift={() => setShifted((v) => !v)}
            />
          )}
        </div>
      )}
    </section>
  )
}

function MeasureRow({ measure }: { measure: MeasureStat }) {
  const { definition, days, byHour } = measure
  const unit = definition.unit ?? ''
  const peak = days.reduce((max, point) => Math.max(max, point.value), 0)

  return (
    <li className="measure">
      <div className="measure__head">
        <span className="measure__name">{definition.name}</span>
        {definition.archived && <span className="stat-bar__tag">보관</span>}
      </div>

      <ul className="measure__facts">
        <li className="measure__fact">
          <span className="measure__value">{round(measure.average)}</span>
          <span className="measure__label">{`평균${unit ? ` (${unit})` : ''}`}</span>
        </li>
        <li className="measure__fact">
          <span className="measure__value">{measure.max === null ? '—' : round(measure.max)}</span>
          <span className="measure__label">최대</span>
        </li>
        <li className="measure__fact">
          <span className="measure__value">{`${measure.recordedDays}일`}</span>
          <span className="measure__label">기록한 날</span>
        </li>
      </ul>

      <div className="measure__scroll">
        <ul className="measure__trend" style={{ minWidth: `${days.length * 10}px` }}>
          {days.map((point) => (
            <li
              key={point.day}
              className="measure__day"
              role="img"
              aria-label={
                point.count === 0
                  ? `${point.day} 기록 없음`
                  : `${point.day} ${round(point.value)}`
              }
            >
              {point.count > 0 && (
                <span
                  className="measure__fill"
                  style={{ height: peak === 0 ? '100%' : `${(point.value / peak) * 100}%` }}
                />
              )}
            </li>
          ))}
        </ul>
      </div>

      {measure.aggregate === 'sum' && <HourBars byHour={byHour} />}
    </li>
  )
}

function HourBars({ byHour }: { byHour: number[] }) {
  const peak = byHour.reduce((max, n) => Math.max(max, n), 0)

  return (
    <div className="measure__hours">
      <span className="measure__label">시각대별 기록</span>
      <div className="measure__scroll">
        <ul className="measure__hourbars">
          {byHour.map((count, hour) => (
            <li
              key={hour}
              className="measure__hour"
              role="img"
              aria-label={`${hour}시 ${count}건`}
            >
              {count > 0 && (
                <span
                  className="measure__fill"
                  style={{ height: peak === 0 ? '100%' : `${(count / peak) * 100}%` }}
                />
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="measure__hourticks" aria-hidden="true">
        <span>0시</span>
        <span>6시</span>
        <span>12시</span>
        <span>18시</span>
        <span>23시</span>
      </div>
    </div>
  )
}

function Overlay({
  measures,
  shifted,
  onShift,
}: {
  measures: MeasureStat[]
  shifted: boolean
  onShift(): void
}) {
  const [firstId, setFirstId] = useState(measures[0]!.definition.id)
  const [secondId, setSecondId] = useState(measures[1]!.definition.id)

  const first = measures.find((m) => m.definition.id === firstId) ?? measures[0]!
  const second = measures.find((m) => m.definition.id === secondId) ?? measures[1]!

  const days = first.days.map((point) => point.day)
  const offset = shifted ? 1 : 0

  return (
    <div className="overlay">
      <div className="overlay__picks">
        <label className="overlay__pick">
          <span className="measure__label">첫째</span>
          <select value={firstId} onChange={(e) => setFirstId(e.target.value)}>
            {measures.map((m) => (
              <option key={m.definition.id} value={m.definition.id}>
                {m.definition.name}
              </option>
            ))}
          </select>
        </label>
        <label className="overlay__pick">
          <span className="measure__label">둘째</span>
          <select value={secondId} onChange={(e) => setSecondId(e.target.value)}>
            {measures.map((m) => (
              <option key={m.definition.id} value={m.definition.id}>
                {m.definition.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={shifted ? 'tab tab--on' : 'tab'}
          aria-pressed={shifted}
          onClick={onShift}
        >
          하루 밀어 보기
        </button>
      </div>

      <p className="hint">
        {shifted
          ? '둘째 지표를 하루 앞으로 당겨 맞췄습니다. 어제 한 것이 오늘 나타나는지 볼 때 씁니다.'
          : '같은 날끼리 맞춰 봅니다. 단위가 다르므로 각자 제 최대값에 맞춰 그립니다.'}
      </p>

      <div className="overlay__body" role="group" aria-label="겹쳐 볼 지표">
        <OverlaySeries measure={first} days={days} offset={0} variant="a" />
        <OverlaySeries measure={second} days={days} offset={offset} variant="b" />
      </div>
    </div>
  )
}

function OverlaySeries({
  measure,
  days,
  offset,
  variant,
}: {
  measure: MeasureStat
  days: string[]
  offset: number
  variant: 'a' | 'b'
}) {
  const peak = measure.days.reduce((max, point) => Math.max(max, point.value), 0)
  const name = measure.definition.name

  return (
    <ul className={`overlay__series overlay__series--${variant}`}>
      {days.map((day, index) => {
        const source = measure.days[index + offset]
        if (source === undefined || source.count === 0) {
          return <li key={day} className="overlay__point" />
        }
        return (
          <li
            key={day}
            className="overlay__point"
            role="img"
            aria-label={`${name} ${day} ${round(source.value)}`}
          >
            <span
              className="overlay__mark"
              style={{ bottom: peak === 0 ? '0%' : `${(source.value / peak) * 100}%` }}
            />
          </li>
        )
      })}
    </ul>
  )
}

function StatBar({ stat }: { stat: HabitStat }) {
  const percent = Math.round(stat.percent)
  const name = stat.definition.name
  const archived = stat.definition.archived

  return (
    <li className={archived ? 'stat-bar stat-bar--archived' : 'stat-bar'}>
      <div className="stat-bar__head">
        <span className="stat-bar__name">{name}</span>
        {archived && <span className="stat-bar__tag">보관</span>}
        <span className="stat-bar__count">
          {`${stat.achievedDays}/${stat.targetDays}일`}
        </span>
        <span className="stat-bar__pct">{`${percent}%`}</span>
      </div>
      <div
        className="stat-bar__track"
        role="img"
        aria-label={archived ? `${name} 보관 ${percent}퍼센트` : `${name} ${percent}퍼센트`}
      >
        <span className="stat-bar__fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="stat-bar__streak">
        {`현재 ${stat.currentStreak}일 · 최장 ${stat.longestStreak}일`}
      </span>
    </li>
  )
}

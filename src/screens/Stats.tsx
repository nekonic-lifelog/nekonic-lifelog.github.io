import { useMemo, useState } from 'react'
import {
  habitStats,
  heatTotals,
  heatmapFor,
  journalStats,
  measureStats,
  rangeFor,
  rangeLabel,
  readingStats,
  summaryFor,
  todoStats,
  weakestWeekday,
  weekdayStats,
  type HabitStat,
  type HeatWeek,
  type MeasureStat,
  type Period,
  type TodoStat,
} from '../lib/stats'
import type { Definition, LogRecord } from '../lib/types'
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
  const [offset, setOffset] = useState(0)

  const range = useMemo(
    () => rangeFor(period, app.today, offset),
    [period, app.today, offset],
  )
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

  const todos = useMemo(
    () => todoStats(app.snapshot, range, opts),
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
            onClick={() => {
              setPeriod(value)
              setOffset(0)
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="stat-move">
        <button
          type="button"
          className="icon-btn"
          aria-label="이전 기간"
          onClick={() => setOffset((v) => v - 1)}
        >
          ‹
        </button>
        <div className="stat-move__label">
          <strong>{rangeLabel(period, range)}</strong>
          <span className="hint stat-range">{`${range.from} ~ ${range.to}`}</span>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="다음 기간"
          disabled={offset >= 0}
          onClick={() => setOffset((v) => Math.min(0, v + 1))}
        >
          ›
        </button>
      </div>

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

      {stats.length > 0 && (
        <PatternCard
          definitions={stats.map((s) => s.definition)}
          records={app.snapshot.records}
          range={range}
          opts={opts}
        />
      )}

      {todos.created + todos.completed + todos.open > 0 && <TodoCard stat={todos} />}

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

function TodoCard({ stat }: { stat: TodoStat }) {
  return (
    <section className="card">
      <div className="card__head">
        <h2>할 일</h2>
      </div>

      <ul className="stat-facts">
        <li className="stat-fact">
          <span className="stat-fact__value">{`${stat.completed}`}</span>
          <span className="stat-fact__label">끝낸 것</span>
        </li>
        <li className="stat-fact">
          <span className="stat-fact__value">
            {stat.onTimePercent === null ? '—' : `${Math.round(stat.onTimePercent)}%`}
          </span>
          <span className="stat-fact__label">기한 지킴</span>
        </li>
        <li className="stat-fact">
          <span className="stat-fact__value">
            {stat.leadTimeDays === null ? '—' : `${round(stat.leadTimeDays)}일`}
          </span>
          <span className="stat-fact__label">걸린 날 (중앙값)</span>
        </li>
        <li className="stat-fact">
          <span className="stat-fact__value">{`${stat.open}`}</span>
          <span className="stat-fact__label">아직 열림</span>
        </li>
      </ul>

      {stat.oldestOpen !== null && (
        <p className="hint">
          {`가장 오래 열려 있는 것: ${stat.oldestOpen.todo.title} · ${stat.oldestOpen.ageDays}일째`}
        </p>
      )}

      {(stat.noDue > 0 || stat.doneWithoutTime > 0) && (
        <p className="hint">
          {`기한 없는 것 ${stat.noDue}건 · 끝낸 시각이 없어 준수 판정에서 뺀 것 ${stat.doneWithoutTime}건`}
        </p>
      )}
    </section>
  )
}

function PatternCard({
  definitions,
  records,
  range,
  opts,
}: {
  definitions: Definition[]
  records: LogRecord[]
  range: { from: string; to: string }
  opts: { boundaryHour: number; clock: { now(): number } }
}) {
  const [open, setOpen] = useState(false)
  const [pickedId, setPickedId] = useState(definitions[0]?.id ?? '')
  const picked = definitions.find((d) => d.id === pickedId) ?? definitions[0]!

  return (
    <section className="card">
      <button
        type="button"
        className="link-btn"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        요일과 한 해 보기
      </button>

      {open && (
        <>
          {definitions.length > 1 && (
            <label className="overlay__pick">
              <span className="measure__label">습관</span>
              <select value={picked.id} onChange={(e) => setPickedId(e.target.value)}>
                {definitions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <WeekdayRow def={picked} records={records} range={range} opts={opts} />
          <Heatmap def={picked} records={records} opts={opts} />
        </>
      )}
    </section>
  )
}

function WeekdayRow({
  def,
  records,
  range,
  opts,
}: {
  def: Definition
  records: LogRecord[]
  range: { from: string; to: string }
  opts: { boundaryHour: number; clock: { now(): number } }
}) {
  const rows = weekdayStats(def, records, range, opts)
  const weakest = weakestWeekday(rows)

  return (
    <div className="weekday">
      <ul className="weekday__row">
        {rows.map((row) => (
          <li
            key={row.weekday}
            className={row.targetDays === 0 ? 'weekday__cell weekday__cell--none' : 'weekday__cell'}
            role="img"
            aria-label={
              row.targetDays === 0
                ? `${row.label}요일 아직 대상 날이 없음`
                : `${row.label}요일 ${row.targetDays}일 중 ${row.achievedDays}일 달성`
            }
          >
            <span className="weekday__label">{row.label}</span>
            <span className="weekday__bar">
              {row.achievedDays > 0 && (
                <span className="weekday__fill" style={{ height: `${row.percent}%` }} />
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="hint">
        {weakest === null
          ? '아직 요일을 가릴 만큼 쌓이지 않았습니다.'
          : `가장 무너지는 요일은 ${weakest.label}요일입니다 (${Math.round(weakest.percent)}%).`}
      </p>
    </div>
  )
}

function Heatmap({
  def,
  records,
  opts,
}: {
  def: Definition
  records: LogRecord[]
  opts: { boundaryHour: number; clock: { now(): number } }
}) {
  const today = new Date(opts.clock.now())
  const year = today.getFullYear()
  const range = { from: `${year}-01-01`, to: `${year}-12-31` }
  const weeks: HeatWeek[] = heatmapFor(def, records, range, opts)
  const totals = heatTotals(weeks)

  return (
    <div className="heat">
      <div
        className="heat__scroll"
        role="img"
        aria-label={`${def.name} ${year}년 대상 ${totals.targetDays}일 중 ${totals.achievedDays}일 달성`}
      >
        <ul className="heat__grid">
          {weeks.map((week) => (
            <li key={week.from} className="heat__week">
              {week.cells.map((cell, i) => (
                <span
                  key={cell === null ? `pad-${i}` : cell.day}
                  className={
                    cell === null
                      ? 'heat__cell heat__cell--pad'
                      : cell.achieved
                        ? 'heat__cell heat__cell--on'
                        : cell.future || !cell.counted
                          ? 'heat__cell heat__cell--off'
                          : 'heat__cell'
                  }
                  title={cell === null ? undefined : cell.day}
                />
              ))}
            </li>
          ))}
        </ul>
      </div>
      <p className="hint">{`${year}년 · 대상 ${totals.targetDays}일 중 ${totals.achievedDays}일 달성`}</p>
    </div>
  )
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

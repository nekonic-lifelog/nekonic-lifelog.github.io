import { useMemo, useState } from 'react'
import {
  habitStats,
  journalStats,
  rangeFor,
  readingStats,
  summaryFor,
  type HabitStat,
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

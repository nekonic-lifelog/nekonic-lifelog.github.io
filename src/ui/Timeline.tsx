import { useMemo } from 'react'
import { daysBetween, type DayKey } from '../lib/day'
import { formatRemaining } from '../lib/select'
import { sortedProjects } from '../lib/selectProjects'
import {
  TIMELINE_MIN_DAYS,
  axisTicks,
  timelineBars,
  timelineRange,
  todayPercent,
  type TimelineBar,
} from '../lib/timeline'
import type { Project } from '../lib/types'
import { useApp } from '../state/app'
import '../styles/timeline.css'

function barLabel(bar: TimelineBar, today: DayKey): string {
  const parts = [
    `${bar.project.name} ${bar.startDay}부터 ${bar.endDay}까지`,
    formatRemaining(daysBetween(bar.endDay, today)),
  ]
  if (bar.clippedStart) parts.push('시작이 범위 밖')
  if (bar.clippedEnd) parts.push('마감이 범위 밖')
  if (bar.project.status === 'done') parts.push('완료')
  else if (bar.project.status === 'held') parts.push('보류')
  else if (bar.overdue) parts.push('기한 지남')
  return parts.join(', ')
}

function barClass(bar: TimelineBar): string {
  const classes = ['tl-bar']
  if (bar.project.status === 'held') classes.push('tl-bar--held')
  if (bar.project.status === 'done') classes.push('tl-bar--done')
  if (bar.overdue) classes.push('tl-bar--overdue')
  if (bar.clippedStart) classes.push('tl-bar--clip-start')
  if (bar.clippedEnd) classes.push('tl-bar--clip-end')
  return classes.join(' ')
}

export function Timeline({ onOpen }: { onOpen?: ((project: Project) => void) | undefined }) {
  const app = useApp()
  const boundaryHour = app.boundaryHour
  const today = app.today

  const projects = useMemo(() => sortedProjects(app.snapshot), [app.snapshot])
  const range = useMemo(
    () => timelineRange(projects, today, TIMELINE_MIN_DAYS, boundaryHour),
    [projects, today, boundaryHour],
  )
  const bars = useMemo(
    () => timelineBars(projects, range, today, boundaryHour),
    [projects, range, today, boundaryHour],
  )
  const ticks = useMemo(() => axisTicks(range), [range])

  const drawn = bars.filter((bar) => !bar.undated)
  const undated = bars.filter((bar) => bar.undated)
  const nowPercent = todayPercent(range, today)

  return (
    <section className="card tl">
      <div className="card__head">
        <h2>일정</h2>
        {projects.length > 0 && (
          <span className="project-count">
            {range.from} ~ {range.to}
          </span>
        )}
      </div>

      {projects.length === 0 ? (
        <p className="empty">표시할 프로젝트가 없습니다.</p>
      ) : (
        <>
          <div className="tl__scroll">
            <div className="tl__chart">
              <div className="tl-row tl-row--axis">
                <span className="tl-name tl-name--axis" aria-hidden="true" />
                <div className="tl-track">
                  <span className="tl-today" style={{ left: `${nowPercent}%` }} />
                  {ticks.map((tick) => (
                    <span key={tick.day} className="tl-tick" style={{ left: `${tick.percent}%` }}>
                      {tick.label}
                    </span>
                  ))}
                </div>
              </div>

              {drawn.length === 0 ? (
                <p className="empty">이 기간에 걸친 프로젝트가 없습니다.</p>
              ) : (
                drawn.map((bar) => (
                  <div key={bar.project.id} className="tl-row">
                    <span className="tl-name">{bar.project.name}</span>
                    <div className="tl-track">
                      <span className="tl-today" style={{ left: `${nowPercent}%` }} />
                      <button
                        type="button"
                        className={barClass(bar)}
                        style={{
                          left: `${bar.offsetPercent}%`,
                          width: `${bar.widthPercent}%`,
                        }}
                        aria-label={barLabel(bar, today)}
                        disabled={!onOpen}
                        onClick={onOpen ? () => onOpen(bar.project) : undefined}
                      >
                        <span className="tl-bar__dday">
                          {formatRemaining(daysBetween(bar.endDay, today))}
                        </span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {undated.length > 0 && (
            <div className="tl-undated">
              <p className="hint">마감이 없어 표시할 수 없음</p>
              <ul className="tl-undated__list">
                {undated.map((bar) => (
                  <li key={bar.project.id} className="tl-undated__item">
                    {bar.project.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}

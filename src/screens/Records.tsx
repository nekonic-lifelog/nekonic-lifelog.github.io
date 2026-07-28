import { useMemo, useState } from 'react'
import {
  groupByDay,
  journalDayLabel,
  journalKindLabel,
  journalPreview,
  journalTimeline,
  JOURNAL_KINDS,
} from '../lib/selectJournal'
import { navigate } from '../lib/router'
import type { Journal, JournalKind } from '../lib/types'
import { useApp } from '../state/app'
import { JournalEdit } from './JournalEdit'
import '../styles/journal.css'

type Editing = Journal | { kind: JournalKind }

function isEntry(editing: Editing): editing is Journal {
  return 'id' in editing
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function timeLabel(at: string): string {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function Records() {
  const app = useApp()
  const [kinds, setKinds] = useState<JournalKind[]>([])
  const [editing, setEditing] = useState<Editing | null>(null)

  const groups = useMemo(
    () => groupByDay(journalTimeline(app.snapshot, kinds), app.boundaryHour),
    [app.snapshot, app.boundaryHour, kinds],
  )

  if (editing) {
    return (
      <JournalEdit
        entry={isEntry(editing) ? editing : null}
        kind={editing.kind}
        onDone={() => setEditing(null)}
      />
    )
  }

  const toggle = (kind: JournalKind) =>
    setKinds((cur) => (cur.includes(kind) ? cur.filter((k) => k !== kind) : [...cur, kind]))

  return (
    <div className="screen">
      <div className="card__head">
        <h1 className="screen__title">기록</h1>
        <button type="button" className="link-btn" onClick={() => navigate('/books')}>
          독서
        </button>
      </div>

      <div className="btn-row journal-new">
        {JOURNAL_KINDS.map((kind) => (
          <button key={kind} type="button" onClick={() => setEditing({ kind })}>
            {journalKindLabel(kind)} 쓰기
          </button>
        ))}
      </div>

      <div className="btn-row journal-filter" role="group" aria-label="종류 필터">
        <button
          type="button"
          className={kinds.length === 0 ? 'journal-chip journal-chip--on' : 'journal-chip'}
          aria-pressed={kinds.length === 0}
          onClick={() => setKinds([])}
        >
          전체
        </button>
        {JOURNAL_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={kinds.includes(kind) ? 'journal-chip journal-chip--on' : 'journal-chip'}
            aria-pressed={kinds.includes(kind)}
            onClick={() => toggle(kind)}
          >
            {journalKindLabel(kind)}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="empty">아직 기록이 없습니다. 일기 · 회의록 · 메모를 남겨 보세요.</p>
      ) : (
        groups.map((group) => (
          <section key={group.day} className="card journal-day">
            <div className="card__head">
              <h2>{journalDayLabel(group.day, app.today)}</h2>
              <span className="hint">{group.entries.length}건</span>
            </div>
            <ul className="journal-list">
              {group.entries.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="journal-item"
                    onClick={() => setEditing(entry)}
                  >
                    <span className="journal-item__meta">
                      <span className="journal-item__time">{timeLabel(entry.at)}</span>
                      <span className="badge">{journalKindLabel(entry.kind)}</span>
                    </span>
                    {entry.title && <span className="journal-item__title">{entry.title}</span>}
                    <span className="journal-item__preview">{journalPreview(entry)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}

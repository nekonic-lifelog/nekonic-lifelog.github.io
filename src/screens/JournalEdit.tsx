import { useEffect, useRef, useState } from 'react'
import type { JournalDraft } from '../data/store'
import { newId } from '../lib/ids'
import { journalKindLabel } from '../lib/selectJournal'
import type { Journal, JournalKind } from '../lib/types'
import { useApp } from '../state/app'
import { draftFields, draftKey, sameFields, useDraftStore } from '../state/drafts'
import { useJournal, type NewJournal } from '../state/journal'

export const DRAFT_SAVE_MS = 5_000

const DRAFT_PREVIEW_MAX = 70
const ELLIPSIS = '…'

export interface JournalEditProps {
  entry: Journal | null
  kind: JournalKind
  onDone(): void
  history?: (() => void) | undefined
  defaultBookId?: string | undefined
}

interface ActionItem {
  key: string
  text: string
  checked: boolean
  sent: boolean
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function draftTimeLabel(savedAt: string): string {
  const d = new Date(savedAt)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function draftPreview(body: string): string {
  const line = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!line) return ''
  return line.length > DRAFT_PREVIEW_MAX
    ? `${line.slice(0, DRAFT_PREVIEW_MAX)}${ELLIPSIS}`
    : line
}

export function JournalEdit({ entry, kind, onDone, history, defaultBookId }: JournalEditProps) {
  const app = useApp()
  const journal = useJournal()
  const drafts = useDraftStore()
  const clock = app.clock

  const key = draftKey(entry, kind)
  const initial = { ...draftFields(entry), bookId: entry?.bookId ?? defaultBookId ?? '' }

  const [current, setCurrent] = useState<Journal | null>(entry)
  const [title, setTitle] = useState(initial.title)
  const [body, setBody] = useState(initial.body)
  const [projectId, setProjectId] = useState(initial.projectId)
  const [bookId, setBookId] = useState(initial.bookId)
  const [attendees, setAttendees] = useState(initial.attendees)
  const [offer, setOffer] = useState<JournalDraft | null>(null)
  const [items, setItems] = useState<ActionItem[]>([])
  const [draft, setDraft] = useState('')
  const [sent, setSent] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const pending = useRef<JournalDraft | null>(null)
  const savedAtMs = useRef(0)
  const wrote = useRef(false)
  const keep = useRef(true)

  const hasTitle = kind !== 'diary'
  const isMeeting = kind === 'meeting'
  const projects = app.snapshot.projects.filter((p) => !p.deleted)
  const books = app.snapshot.books.filter((b) => !b.deleted)
  const hasBook = kind === 'memo' && (books.length > 0 || bookId !== '')
  const canSave = body.trim().length > 0 && !busy
  const pendingItems = items.filter((i) => i.checked && !i.sent && i.text.trim().length > 0)

  const fields = { title, body, projectId, bookId, attendees }
  const worthKeeping = body.trim().length > 0 && !sameFields(fields, initial)

  useEffect(() => {
    let alive = true
    void drafts
      .loadDraft(key)
      .then((found) => {
        if (!alive || found === null) return
        if (found.body.trim().length === 0) return
        if (sameFields(found, draftFields(entry))) return
        setOffer(found)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [drafts, key, entry])

  useEffect(() => {
    const next: JournalDraft | null = worthKeeping
      ? {
          key,
          kind,
          title,
          body,
          projectId,
          bookId,
          attendees,
          savedAt: new Date(clock.now()).toISOString(),
        }
      : null
    pending.current = next

    if (next === null) {
      if (wrote.current) {
        wrote.current = false
        savedAtMs.current = 0
        void drafts.clearDraft(key).catch(() => undefined)
      }
      return
    }

    const now = clock.now()
    if (wrote.current && now - savedAtMs.current < DRAFT_SAVE_MS) return
    wrote.current = true
    savedAtMs.current = now
    void drafts.saveDraft(next).catch(() => undefined)
  }, [worthKeeping, title, body, projectId, bookId, attendees, key, kind, clock, drafts])

  useEffect(
    () => () => {
      if (!keep.current) return
      const last = pending.current
      if (last !== null) void drafts.saveDraft(last).catch(() => undefined)
    },
    [drafts],
  )

  const forget = () => {
    keep.current = false
    pending.current = null
    wrote.current = false
    return drafts.clearDraft(key).catch(() => undefined)
  }

  const resumeDraft = () => {
    if (offer === null) return
    setTitle(offer.title)
    setBody(offer.body)
    setProjectId(offer.projectId)
    setBookId(offer.bookId)
    setAttendees(offer.attendees)
    wrote.current = true
    savedAtMs.current = clock.now()
    setOffer(null)
  }

  const discardDraft = () => {
    wrote.current = false
    savedAtMs.current = 0
    void drafts.clearDraft(key).catch(() => undefined)
    setOffer(null)
  }

  const draftInput = (): NewJournal => ({
    kind,
    title: hasTitle ? title : undefined,
    body,
    projectId: isMeeting ? projectId || undefined : undefined,
    bookId: kind === 'memo' ? bookId || undefined : current?.bookId,
    attendees: isMeeting ? attendees.split(',') : undefined,
  })

  const save = async () => {
    if (!canSave) return
    setBusy(true)
    const input = draftInput()
    if (current) {
      await journal.editJournal(current, {
        title: input.title,
        body: input.body,
        projectId: input.projectId,
        bookId: input.bookId,
        attendees: input.attendees,
      })
    } else {
      await journal.addJournal(input)
    }
    await forget()
    onDone()
  }

  const remove = async () => {
    if (!current) {
      await forget()
      onDone()
      return
    }
    setBusy(true)
    await journal.removeJournal(current)
    await forget()
    onDone()
  }

  const addItem = () => {
    if (!draft.trim()) return
    setItems((cur) => [...cur, { key: newId(), text: draft.trim(), checked: true, sent: false }])
    setDraft('')
  }

  const sendItems = async () => {
    if (pendingItems.length === 0) return
    setBusy(true)
    let target = current
    if (!target) {
      target = await journal.addJournal(draftInput())
      setCurrent(target)
    }
    await journal.actionItemsToTodos(
      target,
      pendingItems.map((i) => i.text),
    )
    const done = new Set(pendingItems.map((i) => i.key))
    setItems((cur) => cur.map((i) => (done.has(i.key) ? { ...i, sent: true } : i)))
    setSent((n) => n + pendingItems.length)
    setBusy(false)
  }

  return (
    <div className="screen">
      <h1 className="screen__title">
        {current ? `${journalKindLabel(kind)} 고치기` : `${journalKindLabel(kind)} 쓰기`}
      </h1>

      {offer && (
        <section className="card journal-draft" role="status">
          <p className="journal-draft__head">
            쓰다 만 글이 남아 있습니다 · {draftTimeLabel(offer.savedAt)}
          </p>
          <p className="journal-draft__preview">{draftPreview(offer.body)}</p>
          <div className="btn-row">
            <button type="button" onClick={resumeDraft}>
              이어쓰기
            </button>
            <button type="button" onClick={discardDraft}>
              버리기
            </button>
          </div>
        </section>
      )}

      <form
        className="card journal-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {hasTitle && (
          <input
            type="text"
            value={title}
            placeholder="제목"
            aria-label="제목"
            onChange={(e) => setTitle(e.target.value)}
          />
        )}

        <textarea
          className="journal-body"
          value={body}
          rows={8}
          placeholder="본문"
          aria-label="본문"
          onChange={(e) => setBody(e.target.value)}
        />

        {hasBook && (
          <label className="journal-field">
            <span>책</span>
            <select value={bookId} aria-label="책" onChange={(e) => setBookId(e.target.value)}>
              <option value="">선택 안 함</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </label>
        )}

        {isMeeting && (
          <>
            <label className="journal-field">
              <span>프로젝트</span>
              <select
                value={projectId}
                aria-label="프로젝트"
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">선택 안 함</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="journal-field">
              <span>참석자</span>
              <input
                type="text"
                value={attendees}
                placeholder="쉼표로 구분"
                aria-label="참석자"
                onChange={(e) => setAttendees(e.target.value)}
              />
            </label>
          </>
        )}

        <div className="btn-row journal-actions">
          <button type="submit" disabled={!canSave}>
            저장
          </button>
          <button type="button" onClick={onDone} disabled={busy}>
            취소
          </button>
          {history && (
            <button type="button" className="link-btn" onClick={history}>
              수정 이력
            </button>
          )}
          {current && !confirming && (
            <button
              type="button"
              className="danger journal-remove"
              onClick={() => setConfirming(true)}
            >
              삭제
            </button>
          )}
          {current && confirming && (
            <>
              <button type="button" className="danger" onClick={() => void remove()}>
                정말 삭제
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                삭제 취소
              </button>
            </>
          )}
        </div>
        {confirming && <p className="hint">삭제하면 목록에서 사라집니다.</p>}
      </form>

      {isMeeting && (
        <section className="card journal-items">
          <div className="card__head">
            <h2>액션 아이템</h2>
            <button
              type="button"
              className="link-btn"
              onClick={() => void sendItems()}
              disabled={pendingItems.length === 0 || busy}
            >
              할 일로 보내기
            </button>
          </div>

          <div className="journal-items__add">
            <input
              type="text"
              value={draft}
              placeholder="액션 아이템"
              aria-label="액션 아이템"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addItem()
                }
              }}
            />
            <button type="button" onClick={addItem} disabled={!draft.trim()}>
              추가
            </button>
          </div>

          {items.length === 0 ? (
            <p className="empty">액션 아이템이 없습니다.</p>
          ) : (
            <ul className="journal-item-list">
              {items.map((item) => (
                <li key={item.key}>
                  <label className="journal-item-row">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      disabled={item.sent}
                      onChange={(e) =>
                        setItems((cur) =>
                          cur.map((i) =>
                            i.key === item.key ? { ...i, checked: e.target.checked } : i,
                          ),
                        )
                      }
                    />
                    <span className={item.sent ? 'journal-item-text--sent' : undefined}>
                      {item.text}
                    </span>
                  </label>
                  {item.sent && <span className="badge">보냄</span>}
                  <button
                    type="button"
                    className="icon-btn icon-btn--danger"
                    aria-label={`${item.text} 지우기`}
                    onClick={() => setItems((cur) => cur.filter((i) => i.key !== item.key))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {sent > 0 && <p className="msg msg--ok">할 일 {sent}건을 보냈습니다.</p>}
        </section>
      )}
    </div>
  )
}

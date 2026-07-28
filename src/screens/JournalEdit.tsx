import { useState } from 'react'
import { newId } from '../lib/ids'
import { journalKindLabel } from '../lib/selectJournal'
import type { Journal, JournalKind } from '../lib/types'
import { useApp } from '../state/app'
import { useJournal, type NewJournal } from '../state/journal'

export interface JournalEditProps {
  entry: Journal | null
  kind: JournalKind
  onDone(): void
  history?: (() => void) | undefined
}

interface ActionItem {
  key: string
  text: string
  checked: boolean
  sent: boolean
}

export function JournalEdit({ entry, kind, onDone, history }: JournalEditProps) {
  const app = useApp()
  const journal = useJournal()

  const [current, setCurrent] = useState<Journal | null>(entry)
  const [title, setTitle] = useState(entry?.title ?? '')
  const [body, setBody] = useState(entry?.body ?? '')
  const [projectId, setProjectId] = useState(entry?.projectId ?? '')
  const [attendees, setAttendees] = useState((entry?.attendees ?? []).join(', '))
  const [items, setItems] = useState<ActionItem[]>([])
  const [draft, setDraft] = useState('')
  const [sent, setSent] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const hasTitle = kind !== 'diary'
  const isMeeting = kind === 'meeting'
  const projects = app.snapshot.projects.filter((p) => !p.deleted)
  const canSave = body.trim().length > 0 && !busy
  const pending = items.filter((i) => i.checked && !i.sent && i.text.trim().length > 0)

  const draftInput = (): NewJournal => ({
    kind,
    title: hasTitle ? title : undefined,
    body,
    projectId: isMeeting ? projectId || undefined : undefined,
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
        attendees: input.attendees,
      })
    } else {
      await journal.addJournal(input)
    }
    onDone()
  }

  const remove = async () => {
    if (!current) {
      onDone()
      return
    }
    setBusy(true)
    await journal.removeJournal(current)
    onDone()
  }

  const addItem = () => {
    if (!draft.trim()) return
    setItems((cur) => [...cur, { key: newId(), text: draft.trim(), checked: true, sent: false }])
    setDraft('')
  }

  const sendItems = async () => {
    if (pending.length === 0) return
    setBusy(true)
    let target = current
    if (!target) {
      target = await journal.addJournal(draftInput())
      setCurrent(target)
    }
    await journal.actionItemsToTodos(
      target,
      pending.map((i) => i.text),
    )
    const done = new Set(pending.map((i) => i.key))
    setItems((cur) => cur.map((i) => (done.has(i.key) ? { ...i, sent: true } : i)))
    setSent((n) => n + pending.length)
    setBusy(false)
  }

  return (
    <div className="screen">
      <h1 className="screen__title">
        {current ? `${journalKindLabel(kind)} 고치기` : `${journalKindLabel(kind)} 쓰기`}
      </h1>

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
              disabled={pending.length === 0 || busy}
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

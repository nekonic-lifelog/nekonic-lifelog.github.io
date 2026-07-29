import { useMemo, useState } from 'react'
import { logicalDay } from '../lib/day'
import {
  bookProgress,
  bookSessions,
  booksByStatus,
  liveBooks,
} from '../lib/selectBooks'
import { journalByBook, journalPreview } from '../lib/selectJournal'
import type { Book, BookStatus, Journal } from '../lib/types'
import { useApp } from '../state/app'
import { useBooks } from '../state/books'
import { JournalEdit } from './JournalEdit'
import '../styles/books.css'
import '../styles/journal.css'

const TABS: { status: BookStatus; label: string }[] = [
  { status: 'reading', label: '읽는 중' },
  { status: 'finished', label: '완독' },
  { status: 'dropped', label: '중단' },
]

interface Writing {
  entry: Journal | null
  bookId: string
}

export function Books() {
  const app = useApp()
  const [tab, setTab] = useState<BookStatus>('reading')
  const [writing, setWriting] = useState<Writing | null>(null)

  const counts = useMemo(() => {
    const all = liveBooks(app.snapshot)
    return {
      reading: all.filter((b) => b.status === 'reading').length,
      finished: all.filter((b) => b.status === 'finished').length,
      dropped: all.filter((b) => b.status === 'dropped').length,
    }
  }, [app.snapshot])

  const shown = useMemo(() => booksByStatus(app.snapshot, tab), [app.snapshot, tab])

  if (writing) {
    return (
      <JournalEdit
        entry={writing.entry}
        kind="memo"
        defaultBookId={writing.bookId}
        onDone={() => setWriting(null)}
      />
    )
  }

  return (
    <div className="screen">
      <h1 className="screen__title">독서</h1>

      <section className="card">
        <div className="card__head">
          <h2>책 등록</h2>
        </div>
        <BookComposer />
      </section>

      <div className="book-tabs" role="tablist">
        {TABS.map(({ status, label }) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={tab === status}
            className={tab === status ? 'book-tab book-tab--on' : 'book-tab'}
            onClick={() => setTab(status)}
          >
            {label} {counts[status]}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="empty">{emptyText(tab)}</p>
      ) : (
        <ul className="book-list">
          {shown.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onWrite={() => setWriting({ entry: null, bookId: book.id })}
              onOpen={(entry) => setWriting({ entry, bookId: entry.bookId ?? book.id })}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function emptyText(status: BookStatus): string {
  if (status === 'reading') return '읽는 중인 책이 없습니다. 위에서 한 권 등록해 보세요.'
  if (status === 'finished') return '아직 다 읽은 책이 없습니다.'
  return '중단한 책이 없습니다.'
}

function BookComposer() {
  const api = useBooks()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [totalPages, setTotalPages] = useState('')

  const reset = () => {
    setTitle('')
    setAuthor('')
    setTotalPages('')
    setOpen(false)
  }

  const submit = () => {
    if (!title.trim()) return
    const pages = Number(totalPages)
    void api.addBook({
      title,
      author: author.trim() || undefined,
      totalPages: totalPages && Number.isFinite(pages) && pages > 0 ? pages : undefined,
    })
    reset()
  }

  if (!open) {
    return (
      <button type="button" className="link-btn" onClick={() => setOpen(true)}>
        + 새 책
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
      <input
        type="text"
        value={title}
        placeholder="제목"
        onChange={(e) => setTitle(e.target.value)}
        aria-label="책 제목"
        autoFocus
      />
      <div className="composer__row">
        <input
          type="text"
          value={author}
          placeholder="지은이 (선택)"
          onChange={(e) => setAuthor(e.target.value)}
          aria-label="지은이"
        />
        <input
          type="number"
          inputMode="numeric"
          value={totalPages}
          placeholder="총 페이지 (선택)"
          onChange={(e) => setTotalPages(e.target.value)}
          aria-label="총 페이지"
        />
      </div>
      <p className="hint">총 페이지를 적어두면 진행률이 나옵니다. 나중에 고쳐도 됩니다.</p>
      <div className="btn-row">
        <button type="submit" disabled={!title.trim()}>
          등록
        </button>
        <button type="button" onClick={reset}>
          취소
        </button>
      </div>
    </form>
  )
}

interface BookCardProps {
  book: Book
  onWrite(): void
  onOpen(entry: Journal): void
}

function BookCard({ book, onWrite, onOpen }: BookCardProps) {
  const app = useApp()
  const api = useBooks()
  const boundaryHour = app.snapshot.settings.dayBoundaryHour
  const progress = useMemo(() => bookProgress(book, app.snapshot), [book, app.snapshot])
  const sessions = useMemo(
    () => bookSessions(book, app.snapshot).slice(0, 3),
    [book, app.snapshot],
  )

  return (
    <li className="card book-card">
      <div className="card__head">
        <div className="book-card__text">
          <span className="book-title">{book.title}</span>
          {book.author && <span className="book-author">{book.author}</span>}
        </div>
        <span className="badge">
          {book.status === 'reading' ? '읽는 중' : book.status === 'finished' ? '완독' : '중단'}
        </span>
      </div>

      <div className="book-bar" role="img" aria-label={progressLabel(progress.percent)}>
        <span className="book-bar__fill" style={{ width: `${progress.percent}%` }} />
      </div>
      <p className="book-pages">
        {progress.pagesRead}
        {progress.totalPages !== null ? ` / ${progress.totalPages}` : ''} 페이지
        {progress.totalPages !== null && ` · ${Math.round(progress.percent)}%`}
      </p>

      {book.status === 'finished' && <Stars book={book} />}

      {book.status !== 'finished' && <ProgressComposer book={book} />}

      {sessions.length > 0 && (
        <ul className="book-sessions">
          {sessions.map((s) => (
            <li key={s.id} className="book-session">
              <span className="book-session__day">{logicalDay(s.at, boundaryHour)}</span>
              <span className="book-session__delta">+{s.value}쪽</span>
              {s.note && <span className="book-session__note">{s.note}</span>}
            </li>
          ))}
        </ul>
      )}

      <BookNotes book={book} onWrite={onWrite} onOpen={onOpen} />

      <div className="btn-row">
        {sessions.length > 0 && (
          <button type="button" onClick={() => void api.undoLastSession(book)}>
            마지막 기록 되돌리기
          </button>
        )}
        {book.status !== 'finished' && (
          <button type="button" onClick={() => void api.setBookStatus(book, 'finished')}>
            다 읽음
          </button>
        )}
        {book.status !== 'reading' && (
          <button type="button" onClick={() => void api.setBookStatus(book, 'reading')}>
            다시 읽는 중
          </button>
        )}
        {book.status === 'reading' && (
          <button type="button" onClick={() => void api.setBookStatus(book, 'dropped')}>
            중단
          </button>
        )}
        <button
          type="button"
          className="danger"
          onClick={() => {
            if (window.confirm(`"${book.title}"을(를) 목록에서 지웁니다. 계속할까요?`)) {
              void api.removeBook(book)
            }
          }}
        >
          삭제
        </button>
      </div>
    </li>
  )
}

function BookNotes({ book, onWrite, onOpen }: BookCardProps) {
  const app = useApp()
  const [open, setOpen] = useState(false)
  const notes = useMemo(() => journalByBook(app.snapshot, book.id), [app.snapshot, book.id])

  return (
    <div className="book-notes">
      <button
        type="button"
        className="link-btn"
        aria-expanded={open}
        aria-label={`${book.title} 메모 ${notes.length}건`}
        onClick={() => setOpen((cur) => !cur)}
      >
        메모 {notes.length}
      </button>

      {open && (
        <>
          {notes.length === 0 ? (
            <p className="empty">아직 붙인 메모가 없습니다.</p>
          ) : (
            <ul className="journal-list">
              {notes.map((note) => (
                <li key={note.id}>
                  <button type="button" className="journal-item" onClick={() => onOpen(note)}>
                    <span className="journal-item__meta">
                      <span className="journal-item__time">
                        {logicalDay(note.at, app.boundaryHour)}
                      </span>
                    </span>
                    {note.title && <span className="journal-item__title">{note.title}</span>}
                    <span className="journal-item__preview">{journalPreview(note)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="link-btn" onClick={onWrite}>
            메모 쓰기
          </button>
        </>
      )}
    </div>
  )
}

function progressLabel(percent: number): string {
  return percent === 0 ? '기록 없음' : `진행률 ${Math.round(percent)}%`
}

function ProgressComposer({ book }: { book: Book }) {
  const app = useApp()
  const api = useBooks()
  const [page, setPage] = useState('')
  const read = bookProgress(book, app.snapshot).pagesRead

  const submit = () => {
    const parsed = Number(page)
    if (!page.trim() || !Number.isFinite(parsed)) return
    void api.logProgress(book, parsed)
    setPage('')
  }

  return (
    <div className="book-log">
      <div className="qty">
        <input
          type="number"
          inputMode="numeric"
          value={page}
          placeholder={`${read}쪽까지 읽음`}
          onChange={(e) => setPage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          aria-label={`${book.title} 도달한 페이지`}
        />
        <button type="button" className="qty__add" onClick={submit} aria-label="기록">
          +
        </button>
      </div>
      <p className="hint">
        누적 쪽수가 아니라 <strong>지금 몇 쪽까지 읽었는지</strong>를 적으세요. 직전
        기록({read}쪽)과의 차이만 이번 기록으로 쌓입니다.
      </p>
    </div>
  )
}

const RATINGS = [1, 2, 3, 4, 5]

function Stars({ book }: { book: Book }) {
  const api = useBooks()
  return (
    <div className="book-stars" role="group" aria-label={`${book.title} 별점`}>
      {RATINGS.map((n) => (
        <button
          key={n}
          type="button"
          className={book.rating !== undefined && book.rating >= n ? 'book-star book-star--on' : 'book-star'}
          aria-pressed={book.rating !== undefined && book.rating >= n}
          aria-label={`별점 ${n}점`}
          onClick={() => void api.rateBook(book, n)}
        >
          ★
        </button>
      ))}
      <span className="hint">{book.rating !== undefined ? `${book.rating} / 5` : '별점 없음'}</span>
    </div>
  )
}

import { useMemo } from 'react'
import { ddayItems, formatRemaining } from '../lib/select'
import { useApp } from '../state/app'

export function DDay() {
  const app = useApp()
  const boundaryHour = app.snapshot.settings.dayBoundaryHour
  const items = useMemo(
    () => ddayItems(app.snapshot, app.today, boundaryHour),
    [app.snapshot, app.today, boundaryHour],
  )

  return (
    <div className="screen">
      <h1 className="screen__title">D-day</h1>

      {items.length === 0 ? (
        <p className="empty">
          고정된 항목이 없습니다. 할 일에 기한을 넣고 ★로 고정하면 여기 올라옵니다.
        </p>
      ) : (
        <>
          <ul className="dday-list dday-list--full">
            {items.map(({ todo, due, remaining }, i) => (
              <li key={todo.id} className={i < 2 ? 'dday-row dday-row--onToday' : 'dday-row'}>
                <span className={remaining < 0 ? 'dday-chip dday-chip--past' : 'dday-chip'}>
                  {formatRemaining(remaining)}
                </span>
                <div className="dday-body">
                  <span className="dday-title">{todo.title}</span>
                  <span className="todo-meta">{due}</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="hint">
            위의 {Math.min(2, items.length)}개가 오늘 화면에 올라갑니다.
          </p>
        </>
      )}
    </div>
  )
}

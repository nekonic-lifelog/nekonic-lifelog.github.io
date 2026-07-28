export function Records() {
  return (
    <Placeholder
      title="기록"
      body="일기 · 회의록 · 메모 · 독서를 한 타임라인에 모을 자리입니다."
    />
  )
}

export function Stats() {
  return (
    <Placeholder
      title="통계"
      body="달성률 · 최장 스트릭 · 습관별 진행률이 들어갈 자리입니다. 전부 기록에서 계산되므로 따로 저장하는 값은 없습니다."
    />
  )
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="screen">
      <h1 className="screen__title">{title}</h1>
      <div className="card placeholder">
        <span className="badge">준비 중</span>
        <p>{body}</p>
      </div>
    </div>
  )
}

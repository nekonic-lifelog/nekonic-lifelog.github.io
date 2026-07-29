# CLAUDE.md

개인용 기록·관리 PWA. 서버 없이 GitHub Pages에 배포하고, 개인 private 저장소에
암호화된 데이터를 직접 읽고 쓴다. 사용자 1명, 기기 2대(폰·PC).

## 이 레포는 public이다 — 어길 수 없는 규칙

1. **코드에 주석을 달지 마라.** `//`, `/* */`, JSDoc 전부. 동작 규칙은 테스트로 표현한다.
   유일한 예외는 러너 지시자(`// @vitest-environment jsdom`).
2. **설계 문서는 `~/Documents/GitHub/lifelog-data/docs/lifelog-spec.md`(private)에 있다.**
   그 문서의 절 번호(§), 설계 근거, 키·토큰 취급 방식을 이 레포의 코드·테스트·주석·커밋 메시지·
   README 어디에도 옮겨 적지 마라. 작업 전에 그 문서를 읽되, 결과물에는 남기지 마라.
3. **실사용 GitHub PAT을 요구하거나 쓰지 마라.** GitHub API는 전부 `fetch`를 목킹한 계약
   테스트로 검증한다. 테스트용 토큰은 `'test-token-do-not-use'`처럼 명백한 가짜로.
   실제 토큰 연결과 폰↔PC 왕복 확인은 사람이 직접 한다.
4. **비밀값을 커밋하지 마라.** 히스토리에서 지워도 이미 복제된 뒤다.
5. 사용자 노출 문자열은 한국어. 들여쓰기 2칸, 세미콜론 없음, 작은따옴표.

## 명령

```bash
npm test          # TZ=Asia/Seoul vitest run
npm run typecheck # tsc -b
npm run build     # tsc -b && vite build
npm run dev
```

테스트는 `TZ=Asia/Seoul`로 고정해 돈다. 하루 경계가 로컬 시간 기준이라 시간대를 고정하지
않으면 결과가 실행 기기에 따라 달라진다.

## 구조

```
src/lib/       clock · day · due · week · streak · stats · timeline · groupTodos
               select* · presets · backup · timer · beep · router · platform · sw
src/data/      store(인터페이스) · idb(구현) · mutations
src/crypto/    kdf · cipher · envelope
src/remote/    github(REST 클라이언트) · tokenScrub
src/sync/      paths · merge · engine · credentials
src/link/      payload · qr · camera · accept
src/state/     app(코어) · habits · todos · journal · books · projects · sync · dirty · bridge
src/screens/   Today · Todos · Projects · Records · JournalEdit · Books · Stats
               DDay · Timer · Link · LinkDevice · Settings · SyncSettings · ReminderSettings
src/ui/        Shell · Timeline · WeekStrip · SyncStatus · PresetPicker
src/check/     환경 점검 페이지 (별도 진입점 /check.html)
```

데이터 접근은 `src/data/store.ts` 인터페이스 뒤에 있다. 저장 방식을 바꿀 때는 구현체만 갈아끼운다.

## 테스트 관례

- **시계는 반드시 주입한다.** `src/lib/clock.ts`의 `fixedClock`/`mutableClock`을 쓴다.
  `Date.now()`를 직접 부르는 코드를 새로 만들지 마라. 경계 조건을 테스트할 수 없게 된다.
- 병합·경로 규칙은 `test/merge.test.ts`·`test/paths.test.ts`의 property test(fast-check)가 정의한다.
  눈으로 검증할 수 없는 영역이므로 여기를 약하게 만들지 마라.
- GitHub API는 `test/github.test.ts`·`test/sync.test.ts`가 목킹한 fetch/인메모리 레포로 검증한다.
- 화면 테스트는 `// @vitest-environment jsdom`을 첫 줄에 둔다.
- **시간이 걸리는 비동기를 고정된 이벤트 루프 횟수로 기다리지 마라.** 조건이 성립할 때까지
  기다려라(`test/sync.test.ts`의 `until`). 횟수로 기다리면 CI에서만 깨진다.
- 계약이 바뀌어 기존 테스트를 고쳐야 하면, 단언을 지우지 말고 새 계약에 맞춰 다시 못 박아라.

## 배포

`main`에 push하면 Actions가 테스트·빌드 후 Pages에 올린다.

- Pages 소스는 **GitHub Actions**여야 한다(브랜치 소스면 배포 단계에서 실패한다).
- 작업은 worktree 브랜치에서 하고, 끝나면 `main`에 fast-forward 머지 후 push한다.
- 배포 성공을 확인하기 전에는 끝났다고 하지 마라.

## 화면을 건드렸으면 눈으로 확인한다

테스트가 통과해도 레이아웃 결함은 잡히지 않는다. 실제로 이 프로젝트에서 테스트를 전부
통과한 채 배포될 뻔한 것들: 칩이 줄 끝까지 늘어남, 숫자 두 개가 똑같이 보여 구분 불가,
원형 칩에 긴 글자가 넘침.

- 개발 서버를 띄우고 **375px과 데스크톱, 다크·라이트** 모두에서 본다.
- **페이지가 가로로 밀리면 안 된다**(`document.scrollWidth === clientWidth`).
  넓은 것(차트·표)은 제 컨테이너 안에서만 스크롤한다.
- 순수 시각 요소(막대·점·칩)에는 `aria-label`로 문장을 달아라. 안 그러면 읽을 수도
  테스트할 수도 없다.

## 조용히 틀리기 쉬운 곳

- **하루 경계는 로컬 시간 기준 설정값(기본 오전 4시)이다.** 날짜를 다룰 때 `logicalDay`를 쓴다.
  자정 기준으로 계산하면 새벽에 넣은 기록이 다음 날로 밀린다.
- **원격 파일 경로는 `createdAt`에서 뽑고 불변이다.** `at`이나 `dueAt`으로 경로를 만들지 마라.
- **각 기기는 자기 파일만 쓴다.** 병합된 전체 뷰를 올리면 두 기기가 서로를 복제한다.
- **삭제는 tombstone이다.** 물리 삭제하면 다른 기기가 동기화할 때 되살린다.
- **`meta/reminders/*.json`은 암호화하지 않는다.** 라벨과 시각만 넣는다.
  기록 본문·건강 데이터·장소·메모를 넣지 마라. 이 규칙은 테스트로 막혀 있다.
- 알림 판정 스크립트는 private 데이터 레포에 있다. 앱이 만든 파일 형식을 바꾸면
  **두 레포에 걸친 계약이 깨진다.** 양쪽 단위 테스트가 초록이어도 알림은 안 간다.

## 지금 상태

구현은 끝났고 테스트 758개가 통과한다. 남은 것은 실제 기기에서의 확인
(폰↔PC 왕복, QR 카메라, 홈 화면 설치, cron 지연 관찰)이며 사람이 해야 한다.

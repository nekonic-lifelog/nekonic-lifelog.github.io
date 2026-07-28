# lifelog

개인용 기록·관리 도구. 습관·할 일·일기·회의록·독서·프로젝트를 로컬에 저장하고,
개인 저장소에 암호화해 기기 사이를 잇는다.

## 개발

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

테스트는 `TZ=Asia/Seoul`로 고정해 돌린다. 하루 경계가 로컬 시간 기준이라
시간대를 고정하지 않으면 결과가 실행 기기에 따라 달라진다.

## 구조

```
src/lib/        clock · day · streak · stats · timer · backup · presets · select*
src/data/       store(인터페이스) · idb(구현) · mutations
src/crypto/     kdf · cipher · envelope
src/remote/     github(REST 클라이언트)
src/sync/       paths · merge · engine · credentials
src/link/       payload · qr · camera
src/state/      AppProvider · habits · todos · journal · books · projects · sync
src/screens/    Today · Todos · Projects · Records · JournalEdit · Books
                Stats · DDay · Timer · Link · Settings
src/ui/         TabBar · 배너 · SyncStatus · PresetPicker
src/check/      환경 점검 페이지 (별도 진입점)
test/           위 각 모듈에 대응
```

데이터 접근은 `src/data/store.ts`의 인터페이스 뒤에 있다.
저장 방식을 바꿀 때는 구현체만 갈아끼운다.

병합과 경로 규칙은 `test/merge.test.ts`의 property test가 정의한다.
GitHub API는 전부 목킹한 계약 테스트로만 검증한다 — 실제 토큰은 테스트에 넣지 않는다.

동작 규칙은 `test/`가 정의한다. 고치기 전에 해당 테스트를 먼저 읽는 편이 빠르다.

## 환경 점검 (`/check.html`)

기기마다 답이 달라 개발 기기에서는 알 수 없는 것들을 재는 진단 페이지다.
설정 화면 아래쪽 링크로 들어간다.

앱과 분리된 별도 진입점이고 CSP도 따로 건다. 저장소도 따로 써서 앱 데이터를
건드리지 않는다.

실제로 쓸 기기에서, 홈 화면에 설치한 상태로 열어야 의미가 있다.
2번은 앱을 완전히 종료했다가 다시 열어야 재는 것이 된다.

| # | 항목 | 맥 데스크톱 |
|---|---|---|
| 1 | 키 유도 속도 (WASM) | 0.1~0.5초 (실행마다 편차) |
| 2 | 키 객체 저장 후 재사용 | 통과 |
| 3 | `CompressionStream` | 통과 (3.0%) |
| 4 | `storage.persist()` | 있음 / `false` 반환 |
| 5 | 설치된 앱에서 카메라 | 확인 불가 |

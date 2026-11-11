# Work Board

개인 업무, 우선순위, 주간/월간 리포트, 근무 기록을 한 화면에서 관리하는 웹 앱입니다.

현재 운영 주소:

```text
https://heochanghoe.github.io/workboard/
```

## 주요 기능

- 빠른 입력: 한 줄로 적으면 프로젝트, 채널, 마감, 우선도를 자동으로 채워 등록
- 회의록: 녹음 텍스트나 메모를 요약, 결정사항, 액션아이템으로 정리하고 프로젝트별/날짜별 조회
- 업무 등록, 빠른 수정, 상태 변경
- 프로젝트별 업무 분류, 운영노트, 업무 목록 필터링
- Today's Priority, Due Soon, Overdue 자동 분류
- 주간 리포트, 월간 리포트 작성/저장
- 출근, 퇴근, 근무 시간 기록
- 업무 변경 이력 자동 기록 (상태, 마감, 프로젝트 등이 바뀌면 별도 입력 없이 남음)
- Google 로그인 기반 Supabase 클라우드 동기화
- 로컬 JSON 백업과 복원

## 파일 구조

- `index.html`: 화면 구조와 앱 진입점
- `style.css`: 디자인, 레이아웃, 모바일 대응 스타일
- `app.js`: 업무, 리포트, 차트 로직
- `smart-capture.js`: 빠른 입력 (기본 규칙 해석, AI 연동, 입력 설정)
- `meetings.js`: 회의록 정리, 저장, 조회
- `supabase/functions/workboard-ai/index.ts`: Claude API를 호출하는 서버 함수 (API 키 보관 위치)
- `task-history.js`: 업무 변경 이력 자동 기록과 표시
- `work-time.js`: 출근, 퇴근, 근무 시간 기록
- `edit-mode.js`: 화면 표시 옵션 저장과 적용
- `project-ops.js`, `project-notes.js`: 프로젝트 운영 타임라인과 운영노트
- `report-format.js`: 주간/월간 리포트 서식
- `cloud-sync.js`: Google 로그인, Supabase 동기화, 백업/복원 로직
- `config.js`: 앱 버전, Supabase URL, Supabase anon public key
- `supabase-schema.sql`: Supabase 테이블, RLS 정책, 업데이트 트리거
- `DEPLOY.md`: GitHub Pages, Supabase, Google OAuth, AI 연결 설정 안내

## 사용 방법

로컬에서는 브라우저로 `index.html`을 열면 됩니다.

여러 기기에서 쓰려면 GitHub Pages 주소로 접속하고 Google 로그인을 사용합니다.

## 데이터 저장 방식

- 기본 데이터는 브라우저 `localStorage`에 저장됩니다.
- 프로젝트 운영노트는 프로젝트명 기준으로 저장되며, 프로젝트명을 바꾸면 기존 노트도 함께 이동합니다.
- Google 로그인 후에는 Supabase에 사용자별 스냅샷으로 동기화됩니다.
- 다른 기기에서 같은 Google 계정으로 로그인하면 같은 업무 데이터를 불러옵니다.
- 회의록의 요약과 액션아이템은 위 스냅샷에 포함됩니다. 회의 원문은 크기가 커서 별도 테이블(`work_board_meeting_texts`)에 저장하고, 로그인하지 않은 상태에서는 최근 몇 건만 이 기기에 보관합니다.
- AI 정리를 쓰면 입력한 문장과 회의 내용이 Supabase 서버 함수를 거쳐 Claude API로 전송됩니다.
- 빈 기기 데이터가 기존 클라우드 데이터를 덮어쓰지 않도록 보호 로직이 들어 있습니다.

## 운영 메모

- `관리` 메뉴 안의 백업 기능으로 JSON 내보내기/가져오기를 할 수 있습니다.
- Supabase 무료 프로젝트는 오래 사용하지 않으면 일시중단될 수 있습니다. 이 경우 Supabase 대시보드에서 프로젝트를 다시 시작해야 동기화가 됩니다.
- `config.js`의 Supabase anon key는 브라우저용 공개 키입니다. 단, `service_role` 키, OAuth secret, DB 비밀번호는 절대 넣으면 안 됩니다.
- 실제 데이터 접근 권한은 `supabase-schema.sql`의 Row Level Security 정책으로 사용자별 제한됩니다.

## 개발

앱은 빌드 없이 정적 파일로 동작합니다. 아래 도구는 수정할 때만 필요합니다.

```bash
npm install      # jsdom, prettier, typescript 설치
npm test         # 화면 흐름, 입력 해석 규칙, 서버 함수 로직을 검증
npm run format   # 코드 줄 정리
```

수정 후에는 `index.html`의 `?v=` 값을 바꿔야 브라우저가 새 파일을 받습니다.


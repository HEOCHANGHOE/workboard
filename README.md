# Work Board

개인 업무, 우선순위, 주간/월간 리포트, 근무 기록을 한 화면에서 관리하는 웹 앱입니다.

현재 운영 주소:

```text
https://heochanghoe.github.io/workboard/
```

## 주요 기능

- 업무 등록, 빠른 수정, 상태 변경
- 프로젝트별 업무 분류와 업무 목록 필터링
- Today's Priority, Due Soon, Overdue 자동 분류
- 주간 리포트, 월간 리포트 작성/저장
- 출근, 퇴근, 근무 시간 기록
- Google 로그인 기반 Supabase 클라우드 동기화
- 로컬 JSON 백업과 복원

## 파일 구조

- `index.html`: 화면 구조와 앱 진입점
- `style.css`: 디자인, 레이아웃, 모바일 대응 스타일
- `app.js`: 업무, 리포트, 근무 관리 로직
- `cloud-sync.js`: Google 로그인, Supabase 동기화, 백업/복원 로직
- `config.js`: 앱 버전, Supabase URL, Supabase anon public key
- `supabase-schema.sql`: Supabase 테이블, RLS 정책, 업데이트 트리거
- `DEPLOY.md`: GitHub Pages, Supabase, Google OAuth 운영 설정 안내

## 사용 방법

로컬에서는 브라우저로 `index.html`을 열면 됩니다.

여러 기기에서 쓰려면 GitHub Pages 주소로 접속하고 Google 로그인을 사용합니다.

## 데이터 저장 방식

- 기본 데이터는 브라우저 `localStorage`에 저장됩니다.
- Google 로그인 후에는 Supabase에 사용자별 스냅샷으로 동기화됩니다.
- 다른 기기에서 같은 Google 계정으로 로그인하면 같은 업무 데이터를 불러옵니다.
- 빈 기기 데이터가 기존 클라우드 데이터를 덮어쓰지 않도록 보호 로직이 들어 있습니다.

## 운영 메모

- `관리` 메뉴 안의 백업 기능으로 JSON 내보내기/가져오기를 할 수 있습니다.
- Supabase 무료 프로젝트는 오래 사용하지 않으면 일시중단될 수 있습니다. 이 경우 Supabase 대시보드에서 프로젝트를 다시 시작해야 동기화가 됩니다.
- `config.js`의 Supabase anon key는 브라우저용 공개 키입니다. 단, `service_role` 키, OAuth secret, DB 비밀번호는 절대 넣으면 안 됩니다.
- 실제 데이터 접근 권한은 `supabase-schema.sql`의 Row Level Security 정책으로 사용자별 제한됩니다.

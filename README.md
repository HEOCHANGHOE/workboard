# Work Board

개인 업무, 리포트, 근무 기록을 관리하는 로컬 HTML 앱입니다.

## 파일 구조

- `index.html`: 화면 구조와 주요 영역 마크업
- `style.css`: 전체 디자인, 레이아웃, 반응형 스타일
- `app.js`: 업무 관리, 리포트, 근무 관리, 테마 설정 로직
- `cloud-sync.js`: 백업/복원, Google 로그인, Supabase 동기화 로직
- `config.js`: Supabase 프로젝트 URL과 anon public key 설정
- `supabase-schema.sql`: Supabase 테이블과 RLS 정책
- `DEPLOY.md`: GitHub Pages와 Supabase 설정 순서

## 실행 방법

브라우저에서 `index.html`을 열면 됩니다.

## 운영 메모

- 업무/근무 데이터는 브라우저 `localStorage`에 저장됩니다.
- `내보내기`/`가져오기` 버튼으로 JSON 백업과 복원이 가능합니다.
- `config.js`와 Supabase 설정을 완료하면 Google 로그인 후 여러 기기에서 같은 데이터를 동기화할 수 있습니다.

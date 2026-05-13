# Work Board 운영 설정

집 PC와 휴대폰에서 같은 업무 데이터를 쓰기 위한 배포/동기화 설정 문서입니다.

## 현재 운영 정보

- GitHub Pages: `https://heochanghoe.github.io/workboard/`
- Supabase Project URL: `https://zsysapxopcxaqvxaqpxe.supabase.co`
- 앱 버전 표기: `config.js`의 `appVersion`

## 1. GitHub Pages

1. GitHub 저장소를 public 상태로 둡니다.
2. 저장소의 `Settings > Pages`로 이동합니다.
3. Source를 `Deploy from a branch`로 설정합니다.
4. Branch는 `main`, folder는 `/root`를 선택합니다.
5. 저장 후 Pages 주소가 live 상태인지 확인합니다.

현재 저장소 기준 운영 주소:

```text
https://heochanghoe.github.io/workboard/
```

## 2. Supabase 데이터베이스

1. Supabase 프로젝트를 열거나 새로 만듭니다.
2. `SQL Editor`에서 `supabase-schema.sql` 전체 내용을 실행합니다.
3. 실행 결과가 `Success. No rows returned`이면 정상입니다.
4. `Table Editor`에서 `work_board_snapshots` 테이블이 보이는지 확인합니다.

이 테이블은 Google 로그인 사용자별로 하나의 업무 데이터 스냅샷을 저장합니다.

## 3. Supabase API 설정

`Project Settings > API`에서 다음 값을 확인해 `config.js`에 넣습니다.

- Project URL
- anon public key

주의:

- anon public key는 브라우저 앱에서 쓰는 공개 키입니다.
- `service_role` 키는 절대 `config.js`에 넣으면 안 됩니다.
- OAuth Client Secret, DB 비밀번호, 개인 토큰도 저장소에 올리면 안 됩니다.

## 4. Google 로그인

Supabase 설정:

1. `Authentication > Providers > Google`을 엽니다.
2. Google provider를 켭니다.
3. Google Cloud Console에서 만든 Client ID와 Client Secret을 입력합니다.
4. Supabase의 `Authentication > URL Configuration`에서 Site URL을 아래로 설정합니다.

```text
https://heochanghoe.github.io/workboard/
```

5. Redirect URLs에도 같은 주소를 추가합니다.

Google Cloud Console 설정:

1. OAuth Client 유형은 `Web application`으로 만듭니다.
2. Authorized JavaScript origins에 GitHub Pages 주소를 추가합니다.

```text
https://heochanghoe.github.io
```

3. Authorized redirect URI에 Supabase 콜백 주소를 추가합니다.

```text
https://zsysapxopcxaqvxaqpxe.supabase.co/auth/v1/callback
```

## 5. 기존 로컬 데이터 이전

PC에 업무 데이터가 이미 있는 경우:

1. PC의 Work Board에서 Google 로그인합니다.
2. 업무가 보이는 상태로 잠시 기다리면 자동 동기화됩니다.
3. 휴대폰에서 GitHub Pages 주소로 접속합니다.
4. 같은 Google 계정으로 로그인합니다.
5. 클라우드 데이터가 휴대폰에 내려오는지 확인합니다.

필요하면 `관리` 메뉴의 백업 기능을 사용합니다.

- 내보내기: 현재 브라우저 데이터를 JSON 파일로 저장
- 가져오기: JSON 백업을 현재 브라우저에 복원
- 불러오기: 클라우드 데이터를 현재 기기로 가져오기
- 올리기: 현재 기기 데이터를 클라우드에 저장

## 6. Supabase 무료 프로젝트 주의

무료 프로젝트는 일정 기간 사용하지 않으면 일시중단될 수 있습니다.

일시중단되면:

- 로그인 또는 동기화가 실패할 수 있습니다.
- Supabase 대시보드에서 `Resume project`를 눌러 다시 시작해야 합니다.
- 일정 기간 안에 재개하지 않으면 프로젝트가 복구 불가 상태가 될 수 있으므로 중요한 데이터는 JSON 백업도 함께 보관하는 것이 좋습니다.

## 7. 배포 후 확인

배포 후 다음을 확인합니다.

1. GitHub Pages 주소가 열리는지 확인
2. Google 로그인 버튼이 보이는지 확인
3. 로그인 후 `클라우드 저장됨` 또는 정상 상태 표시가 되는지 확인
4. PC에서 만든 업무가 휴대폰에서도 보이는지 확인
5. 휴대폰에서 만든 업무가 PC에서도 보이는지 확인

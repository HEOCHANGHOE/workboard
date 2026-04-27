# Work Board Cloud Setup

이 문서는 집 PC와 휴대폰에서 같은 Work Board 데이터를 쓰기 위한 설정 순서입니다.

## 1. GitHub Pages

1. 이 폴더를 GitHub 저장소에 올립니다.
2. GitHub 저장소의 `Settings > Pages`로 이동합니다.
3. `Deploy from a branch`를 선택합니다.
4. Branch는 `main`, folder는 `/root`를 선택합니다.
5. 발급된 Pages 주소를 확인합니다.

예시:

```text
https://YOUR_GITHUB_ID.github.io/YOUR_REPOSITORY/
```

## 2. Supabase

1. Supabase에서 새 프로젝트를 만듭니다.
2. `SQL Editor`에서 `supabase-schema.sql` 내용을 실행합니다.
3. `Project Settings > API`에서 다음 값을 확인합니다.
   - Project URL
   - anon public key
4. `config.js`에 위 값을 입력합니다.

## 3. Google 로그인

1. Supabase의 `Authentication > Providers > Google`을 엽니다.
2. Google provider를 켭니다.
3. Google Cloud Console에서 OAuth Client ID와 Client Secret을 생성합니다.
4. Google OAuth Client의 Authorized redirect URI에 Supabase 콜백 주소를 추가합니다.

```text
https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback
```

5. Supabase Google provider 화면에 Client ID와 Secret을 입력합니다.
6. Supabase의 `Authentication > URL Configuration`에서 Site URL을 GitHub Pages 주소로 설정합니다.
7. Redirect URLs에 GitHub Pages 주소를 추가합니다.

예시:

```text
https://YOUR_GITHUB_ID.github.io/YOUR_REPOSITORY/
```

## 4. 기존 로컬 데이터 이전

1. 현재 로컬 앱에서 `내보내기`를 눌러 백업 JSON을 저장합니다.
2. GitHub Pages 주소로 접속합니다.
3. `Google 로그인`을 진행합니다.
4. `가져오기`로 백업 JSON을 복원합니다.
5. `올리기`를 눌러 Supabase에 저장합니다.

이후 집 PC와 휴대폰에서는 같은 GitHub Pages 주소로 접속하고 Google 로그인하면 같은 데이터를 사용할 수 있습니다.

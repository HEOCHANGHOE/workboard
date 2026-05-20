# Work Board security setup

## Required Supabase step

After deploying these files, run `supabase-schema.sql` in the Supabase SQL Editor.

The migration adds:

- `work_board_user_profiles`: approval status and role per Google account
- RLS policies that allow snapshot read/write only for approved users
- `work_board_register_current_user()`: creates a pending profile after Google login
- `work_board_set_user_access()`: owner/admin-only approval and role changes

`gobonk07@gmail.com` is the bootstrap admin account. When that exact Google
email signs in, it is automatically marked `approved` with the `admin` role, so
it can approve the other users without waiting for approval itself.

Existing cloud users are migration-safe: if a signed-in account already has a
`work_board_snapshots` row, it is approved when it next signs in. The first
existing cloud user who signs in becomes `owner`; later existing users become
`member`.

## User approval flow

1. A new user signs in with Google.
2. The app creates a `pending` profile.
3. An `owner` or `admin` opens `관리 > 사용자 관리`.
4. Change the user status to `승인됨` and save.

Only approved users can use cloud pull/push. Pending or blocked users cannot
read or write cloud snapshots even if they call the Supabase API directly.

## Recommended console settings

- Supabase Auth redirect URLs: keep only the production GitHub Pages URL.
- Google OAuth origins: keep only `https://heochanghoe.github.io`.
- Enable 2FA on GitHub, Google, and Supabase owner accounts.

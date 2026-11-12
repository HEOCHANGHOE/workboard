-- Work Board Supabase schema
-- Run this in Supabase SQL Editor after creating the project.
--
-- Security model:
-- - Google Auth proves identity.
-- - work_board_user_profiles stores approval state and role.
-- - Row Level Security blocks cloud snapshots unless the signed-in user is approved.
-- - gobonk07@gmail.com is a bootstrap admin account and is auto-approved on login.
-- - Admin actions go through SECURITY DEFINER RPC functions with fixed search_path.

create table if not exists public.work_board_user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create unique index if not exists work_board_user_profiles_email_key
on public.work_board_user_profiles (lower(email));

create table if not exists public.work_board_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.work_board_user_profiles enable row level security;
alter table public.work_board_snapshots enable row level security;

create or replace function public.set_work_board_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_work_board_user_profiles_updated_at on public.work_board_user_profiles;
create trigger set_work_board_user_profiles_updated_at
before update on public.work_board_user_profiles
for each row
execute function public.set_work_board_updated_at();

drop trigger if exists set_work_board_updated_at on public.work_board_snapshots;
create trigger set_work_board_updated_at
before insert or update on public.work_board_snapshots
for each row
execute function public.set_work_board_updated_at();

create or replace function public.work_board_is_approved(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.work_board_user_profiles p
    where p.user_id = check_user_id
      and p.status = 'approved'
      and p.role in ('owner', 'admin', 'member')
  );
$$;

create or replace function public.work_board_is_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.work_board_user_profiles p
    where p.user_id = check_user_id
      and p.status = 'approved'
      and p.role in ('owner', 'admin')
  );
$$;

create or replace function public.work_board_is_owner(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.work_board_user_profiles p
    where p.user_id = check_user_id
      and p.status = 'approved'
      and p.role = 'owner'
  );
$$;

create or replace function public.work_board_register_current_user()
returns public.work_board_user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  claims jsonb := auth.jwt();
  current_email text := lower(nullif(coalesce(claims ->> 'email', ''), ''));
  current_name text := nullif(coalesce(claims ->> 'name', claims ->> 'full_name', ''), '');
  bootstrap_admin_emails constant text[] := array['gobonk07@gmail.com'];
  has_existing_snapshot boolean := false;
  has_owner boolean := false;
  default_status text := 'pending';
  default_role text := 'member';
  result public.work_board_user_profiles;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if current_email is null then
    raise exception 'Google account email is required.';
  end if;

  select exists (
    select 1
    from public.work_board_snapshots s
    where s.user_id = current_user_id
  ) into has_existing_snapshot;

  select exists (
    select 1
    from public.work_board_user_profiles p
    where p.status = 'approved'
      and p.role = 'owner'
  ) into has_owner;

  -- Migration safety: existing cloud users keep access after this schema is applied.
  -- The first existing cloud user who signs in becomes owner; later existing users become members.
  if has_existing_snapshot then
    default_status := 'approved';
    default_role := case when has_owner then 'member' else 'owner' end;
  end if;

  if current_email = any (bootstrap_admin_emails) then
    default_status := 'approved';
    default_role := 'admin';
  end if;

  insert into public.work_board_user_profiles (
    user_id,
    email,
    display_name,
    role,
    status,
    requested_at,
    approved_at,
    approved_by
  )
  values (
    current_user_id,
    current_email,
    coalesce(current_name, split_part(current_email, '@', 1)),
    default_role,
    default_status,
    now(),
    case when default_status = 'approved' then now() else null end,
    case when default_status = 'approved' then current_user_id else null end
  )
  on conflict (user_id) do update
  set
    email = excluded.email,
    display_name = coalesce(nullif(public.work_board_user_profiles.display_name, ''), excluded.display_name),
    status = case
      when excluded.email = any (bootstrap_admin_emails) then 'approved'
      when public.work_board_user_profiles.status = 'pending' and has_existing_snapshot then 'approved'
      else public.work_board_user_profiles.status
    end,
    role = case
      when excluded.email = any (bootstrap_admin_emails)
        and public.work_board_user_profiles.role <> 'owner' then 'admin'
      when public.work_board_user_profiles.role = 'member'
        and has_existing_snapshot
        and not has_owner then 'owner'
      else public.work_board_user_profiles.role
    end,
    approved_at = case
      when public.work_board_user_profiles.status = 'pending' and has_existing_snapshot then now()
      else public.work_board_user_profiles.approved_at
    end,
    approved_by = case
      when public.work_board_user_profiles.status = 'pending' and has_existing_snapshot then current_user_id
      else public.work_board_user_profiles.approved_by
    end
  returning * into result;

  return result;
end;
$$;

create or replace function public.work_board_set_user_access(
  target_user_id uuid,
  next_status text,
  next_role text default null
)
returns public.work_board_user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_owner boolean := false;
  actor_is_admin boolean := false;
  current_profile public.work_board_user_profiles;
  final_role text;
  approved_owner_count integer := 0;
  result public.work_board_user_profiles;
begin
  if actor_id is null then
    raise exception 'Authentication is required.';
  end if;

  actor_is_owner := public.work_board_is_owner(actor_id);
  actor_is_admin := public.work_board_is_admin(actor_id);

  if not actor_is_admin then
    raise exception 'Admin access is required.';
  end if;

  if next_status not in ('pending', 'approved', 'blocked') then
    raise exception 'Invalid status.';
  end if;

  select *
  into current_profile
  from public.work_board_user_profiles
  where user_id = target_user_id;

  if not found then
    raise exception 'User profile was not found.';
  end if;

  final_role := coalesce(next_role, current_profile.role);
  if final_role not in ('owner', 'admin', 'member') then
    raise exception 'Invalid role.';
  end if;

  if not actor_is_owner and (current_profile.role = 'owner' or final_role = 'owner') then
    raise exception 'Only owners can manage owner access.';
  end if;

  if target_user_id = actor_id and (next_status <> 'approved' or final_role <> current_profile.role) then
    raise exception 'You cannot change your own active access.';
  end if;

  if current_profile.role = 'owner' and (next_status <> 'approved' or final_role <> 'owner') then
    select count(*)
    into approved_owner_count
    from public.work_board_user_profiles
    where status = 'approved'
      and role = 'owner';

    if approved_owner_count <= 1 then
      raise exception 'At least one approved owner is required.';
    end if;
  end if;

  update public.work_board_user_profiles
  set
    status = next_status,
    role = final_role,
    approved_at = case when next_status = 'approved' then coalesce(approved_at, now()) else null end,
    approved_by = case when next_status = 'approved' then actor_id else null end
  where user_id = target_user_id
  returning * into result;

  return result;
end;
$$;

revoke all on function public.work_board_is_approved(uuid) from public;
revoke all on function public.work_board_is_admin(uuid) from public;
revoke all on function public.work_board_is_owner(uuid) from public;
revoke all on function public.work_board_register_current_user() from public;
revoke all on function public.work_board_set_user_access(uuid, text, text) from public;

grant execute on function public.work_board_is_approved(uuid) to authenticated;
grant execute on function public.work_board_is_admin(uuid) to authenticated;
grant execute on function public.work_board_is_owner(uuid) to authenticated;
grant execute on function public.work_board_register_current_user() to authenticated;
grant execute on function public.work_board_set_user_access(uuid, text, text) to authenticated;

drop policy if exists "Users can read their own Work Board profile" on public.work_board_user_profiles;
create policy "Users can read their own Work Board profile"
on public.work_board_user_profiles
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Admins can read Work Board profiles" on public.work_board_user_profiles;
create policy "Admins can read Work Board profiles"
on public.work_board_user_profiles
for select
to authenticated
using (public.work_board_is_admin(auth.uid()));

drop policy if exists "Users can read their Work Board snapshot" on public.work_board_snapshots;
drop policy if exists "Users can insert their Work Board snapshot" on public.work_board_snapshots;
drop policy if exists "Users can update their Work Board snapshot" on public.work_board_snapshots;

drop policy if exists "Approved users can read their Work Board snapshot" on public.work_board_snapshots;
create policy "Approved users can read their Work Board snapshot"
on public.work_board_snapshots
for select
to authenticated
using (auth.uid() = user_id and public.work_board_is_approved(auth.uid()));

drop policy if exists "Approved users can insert their Work Board snapshot" on public.work_board_snapshots;
create policy "Approved users can insert their Work Board snapshot"
on public.work_board_snapshots
for insert
to authenticated
with check (auth.uid() = user_id and public.work_board_is_approved(auth.uid()));

drop policy if exists "Approved users can update their Work Board snapshot" on public.work_board_snapshots;
create policy "Approved users can update their Work Board snapshot"
on public.work_board_snapshots
for update
to authenticated
using (auth.uid() = user_id and public.work_board_is_approved(auth.uid()))
with check (auth.uid() = user_id and public.work_board_is_approved(auth.uid()));

-- ============================================================
-- Meeting original texts (v2.7.0)
-- Minutes (summary, decisions, action items) live in the snapshot.
-- The full transcript is large, so it is stored here, one row per meeting.
-- Safe to run more than once.
-- ============================================================
create table if not exists public.work_board_meeting_texts (
  user_id uuid not null references auth.users(id) on delete cascade,
  meeting_id text not null check (char_length(meeting_id) between 1 and 80),
  raw_text text not null check (char_length(raw_text) <= 200000),
  updated_at timestamptz not null default now(),
  primary key (user_id, meeting_id)
);

alter table public.work_board_meeting_texts enable row level security;

drop policy if exists "Approved users can read their meeting texts" on public.work_board_meeting_texts;
create policy "Approved users can read their meeting texts"
on public.work_board_meeting_texts
for select
to authenticated
using (auth.uid() = user_id and public.work_board_is_approved(auth.uid()));

drop policy if exists "Approved users can insert their meeting texts" on public.work_board_meeting_texts;
create policy "Approved users can insert their meeting texts"
on public.work_board_meeting_texts
for insert
to authenticated
with check (auth.uid() = user_id and public.work_board_is_approved(auth.uid()));

drop policy if exists "Approved users can update their meeting texts" on public.work_board_meeting_texts;
create policy "Approved users can update their meeting texts"
on public.work_board_meeting_texts
for update
to authenticated
using (auth.uid() = user_id and public.work_board_is_approved(auth.uid()))
with check (auth.uid() = user_id and public.work_board_is_approved(auth.uid()));

drop policy if exists "Approved users can delete their meeting texts" on public.work_board_meeting_texts;
create policy "Approved users can delete their meeting texts"
on public.work_board_meeting_texts
for delete
to authenticated
using (auth.uid() = user_id and public.work_board_is_approved(auth.uid()));

grant select, insert, update, delete on public.work_board_meeting_texts to authenticated;

-- ============================================================
-- GitHub report feed (v2.8.0)
-- One row per user: the "Github 관리" tab's feed (repo status, daily run log,
-- report summaries) built by tools/github-feed-export.py from the report folder.
-- Kept out of the snapshot because it is large and is replaced as a whole.
-- Safe to run more than once.
-- ============================================================
create table if not exists public.work_board_github_feed (
  user_id uuid primary key references auth.users(id) on delete cascade,
  feed jsonb not null check (octet_length(feed::text) <= 4000000),
  generated_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.work_board_github_feed enable row level security;

drop policy if exists "Approved users can read their GitHub feed" on public.work_board_github_feed;
create policy "Approved users can read their GitHub feed"
on public.work_board_github_feed
for select
to authenticated
using (auth.uid() = user_id and public.work_board_is_approved(auth.uid()));

drop policy if exists "Approved users can insert their GitHub feed" on public.work_board_github_feed;
create policy "Approved users can insert their GitHub feed"
on public.work_board_github_feed
for insert
to authenticated
with check (auth.uid() = user_id and public.work_board_is_approved(auth.uid()));

drop policy if exists "Approved users can update their GitHub feed" on public.work_board_github_feed;
create policy "Approved users can update their GitHub feed"
on public.work_board_github_feed
for update
to authenticated
using (auth.uid() = user_id and public.work_board_is_approved(auth.uid()))
with check (auth.uid() = user_id and public.work_board_is_approved(auth.uid()));

drop policy if exists "Approved users can delete their GitHub feed" on public.work_board_github_feed;
create policy "Approved users can delete their GitHub feed"
on public.work_board_github_feed
for delete
to authenticated
using (auth.uid() = user_id and public.work_board_is_approved(auth.uid()));

grant select, insert, update, delete on public.work_board_github_feed to authenticated;

-- ------------------------------------------------------------
-- Unattended upload of the GitHub feed (tools/github-feed-sync.py).
-- A feed token can only replace its owner's row in work_board_github_feed.
-- Only the token's SHA-256 hash is stored. Create one in the SQL Editor:
--   insert into public.work_board_feed_tokens (token_hash, user_id, label)
--   select '<sha256 hex of the token>', id, 'report PC' from auth.users where email = '<your login email>'
--   returning user_id;
-- ------------------------------------------------------------
create table if not exists public.work_board_feed_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  created_at timestamptz not null default now()
);

alter table public.work_board_feed_tokens enable row level security;
revoke all on public.work_board_feed_tokens from anon, authenticated;

create or replace function public.work_board_ingest_github_feed(p_token text, p_feed jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  stored timestamptz := now();
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'invalid feed token' using errcode = '28000';
  end if;
  select t.user_id into target
  from public.work_board_feed_tokens t
  where t.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if target is null or not public.work_board_is_approved(target) then
    raise exception 'invalid feed token' using errcode = '28000';
  end if;
  if p_feed is null or p_feed->>'type' is distinct from 'workboard-github-feed' then
    raise exception 'invalid feed' using errcode = '22023';
  end if;
  insert into public.work_board_github_feed (user_id, feed, generated_at, updated_at)
  values (target, p_feed, nullif(p_feed->>'generatedAt', '')::timestamptz, stored)
  on conflict (user_id) do update
    set feed = excluded.feed, generated_at = excluded.generated_at, updated_at = excluded.updated_at;
  return stored;
end;
$$;

revoke all on function public.work_board_ingest_github_feed(text, jsonb) from public;
grant execute on function public.work_board_ingest_github_feed(text, jsonb) to anon, authenticated;

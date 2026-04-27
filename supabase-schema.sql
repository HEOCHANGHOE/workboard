-- Work Board Supabase schema
-- Run this in Supabase SQL Editor after creating the project.

create table if not exists public.work_board_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.work_board_snapshots enable row level security;

drop policy if exists "Users can read their Work Board snapshot" on public.work_board_snapshots;
create policy "Users can read their Work Board snapshot"
on public.work_board_snapshots
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their Work Board snapshot" on public.work_board_snapshots;
create policy "Users can insert their Work Board snapshot"
on public.work_board_snapshots
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their Work Board snapshot" on public.work_board_snapshots;
create policy "Users can update their Work Board snapshot"
on public.work_board_snapshots
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.set_work_board_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_work_board_updated_at on public.work_board_snapshots;
create trigger set_work_board_updated_at
before update on public.work_board_snapshots
for each row
execute function public.set_work_board_updated_at();

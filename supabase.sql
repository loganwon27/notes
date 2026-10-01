-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
create table if not exists public.notes (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  text text not null default '',
  pinned boolean not null default false,
  created bigint not null,
  updated bigint not null,
  deleted boolean not null default false
);

alter table public.notes enable row level security;

-- Each person can only see and change their own notes.
drop policy if exists "own notes" on public.notes;
create policy "own notes" on public.notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

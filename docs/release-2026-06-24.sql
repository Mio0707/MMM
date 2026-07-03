-- Release helper for song ordering and private cumulative unique user count.
-- Run this once in Supabase SQL editor before publishing the new build.

alter table public.songs
  add column if not exists sort_order integer;

create index if not exists songs_sort_order_idx
  on public.songs (sort_order);

create table if not exists public.app_users (
  visitor_id text primary key,
  first_seen_at timestamptz not null default now()
);

alter table public.app_users enable row level security;

drop policy if exists "Public can count app users" on public.app_users;

drop policy if exists "Public can register app users" on public.app_users;
create policy "Public can register app users"
  on public.app_users
  for insert
  to anon, authenticated
  with check (true);

-- Optional example:
-- update public.songs set sort_order = 10 where "songId" = 'Mr.Aimeimohu01';
-- update public.songs set sort_order = 20 where "songId" = 'Destiny01';

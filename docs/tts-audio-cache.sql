create table if not exists public.tts_audio_cache (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  voice text not null,
  audio_url text not null,
  storage_path text not null,
  provider text not null default 'edge-tts',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (text, voice)
);

alter table public.tts_audio_cache enable row level security;

drop policy if exists "Public can read TTS audio cache" on public.tts_audio_cache;
create policy "Public can read TTS audio cache"
on public.tts_audio_cache
for select
to anon, authenticated
using (true);

grant select on public.tts_audio_cache to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tts-cache', 'tts-cache', true, 10485760, array['audio/mpeg'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ─── DrumHero B12: biblioteca en la nube (PLAN_V2 §3.1) ─────────────────────
-- songs / charts / jobs por usuario (RLS), analysis_cache y workers solo para el
-- worker (service role). El navegador sube el MP3 a Storage y crea un job; el
-- worker de la PC lo reclama con claim_next_job(), analiza y deja el resultado.

-- updated_at automático
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ─── songs ──────────────────────────────────────────────────────────────────
create table public.songs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  artist text not null default '' check (char_length(artist) <= 200),
  file_name text not null check (char_length(file_name) between 1 and 200),
  -- audio/{user_id}/{song_id}/original.{ext}
  audio_path text not null,
  audio_sha256 text check (audio_sha256 is null or audio_sha256 ~ '^[0-9a-f]{64}$'),
  duration_s real not null check (duration_s > 0 and duration_s <= 600),
  youtube_url text check (youtube_url is null or char_length(youtube_url) <= 300),
  youtube_offset_ms integer not null default 0,
  status text not null default 'analyzing'
    check (status in ('analyzing', 'ready', 'needs_review', 'failed')),
  summary jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_played_at timestamptz,
  constraint songs_audio_path_owned check (audio_path like user_id::text || '/' || id::text || '/%')
);

create index songs_user_created_idx on public.songs (user_id, created_at desc);

create trigger songs_updated_at before update on public.songs
  for each row execute function public.set_updated_at();

-- ─── charts (los escribe el worker; el editor de la Fase C los actualizará) ──
create table public.charts (
  song_id uuid primary key references public.songs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  version integer not null default 2,
  data jsonb not null,
  peaks jsonb,
  -- stems/{user_id}/{song_id}/drums.ogg y backing.ogg
  drums_path text,
  backing_path text,
  edited boolean not null default false,
  updated_at timestamptz not null default now()
);

create index charts_user_idx on public.charts (user_id);

create trigger charts_updated_at before update on public.charts
  for each row execute function public.set_updated_at();

-- ─── jobs ───────────────────────────────────────────────────────────────────
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status text not null default 'queued' check (status in (
    'queued', 'separating', 'transcribing', 'tempo', 'quantizing', 'finalizing',
    'done', 'failed', 'canceled'
  )),
  stages jsonb not null default '[
    {"id": "separate", "label": "Separar la batería del resto", "state": "pending", "progress": 0},
    {"id": "transcribe", "label": "Detectar golpes por pieza", "state": "pending", "progress": 0},
    {"id": "tempo", "label": "Detectar tempo y compases", "state": "pending", "progress": 0},
    {"id": "quantize", "label": "Cuantizar a la rejilla", "state": "pending", "progress": 0},
    {"id": "difficulties", "label": "Generar 3 dificultades", "state": "pending", "progress": 0}
  ]'::jsonb,
  summary jsonb,
  error jsonb,
  cached boolean not null default false,
  cancel_requested boolean not null default false,
  worker_id text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_queued_idx on public.jobs (created_at) where status = 'queued';
create index jobs_song_idx on public.jobs (song_id);
create index jobs_user_idx on public.jobs (user_id);

create trigger jobs_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

-- ─── analysis_cache y workers (solo service role) ───────────────────────────
create table public.analysis_cache (
  audio_sha256 text primary key check (audio_sha256 ~ '^[0-9a-f]{64}$'),
  chart jsonb not null,
  peaks jsonb not null,
  -- stems de la primera canción analizada con ese audio (se copian a cada usuario)
  drums_path text not null,
  backing_path text not null,
  created_at timestamptz not null default now()
);

-- Latido del worker: la app avisa si nadie va a recoger los trabajos
create table public.workers (
  id text primary key,
  device text not null,
  models jsonb not null default '{}'::jsonb,
  last_seen timestamptz not null default now()
);

-- ─── Permisos: nada por defecto, solo lo necesario por columna ──────────────
revoke all on public.songs, public.charts, public.jobs, public.analysis_cache, public.workers
  from anon, authenticated;
grant all on public.songs, public.charts, public.jobs, public.analysis_cache, public.workers
  to service_role;

grant select, delete on public.songs to authenticated;
grant insert (id, title, artist, file_name, audio_path, audio_sha256, duration_s, youtube_url)
  on public.songs to authenticated;
grant update (title, artist, youtube_url, youtube_offset_ms, last_played_at)
  on public.songs to authenticated;

grant select on public.charts to authenticated;

grant select on public.jobs to authenticated;
grant insert (song_id) on public.jobs to authenticated;
grant update (cancel_requested) on public.jobs to authenticated;

grant select (id, last_seen) on public.workers to authenticated;

alter table public.songs enable row level security;
alter table public.charts enable row level security;
alter table public.jobs enable row level security;
alter table public.analysis_cache enable row level security;
alter table public.workers enable row level security;

create policy "songs: el dueño las ve" on public.songs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "songs: el dueño las crea" on public.songs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "songs: el dueño las edita" on public.songs
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "songs: el dueño las borra" on public.songs
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "charts: el dueño los ve" on public.charts
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "jobs: el dueño los ve" on public.jobs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "jobs: solo para canciones propias" on public.jobs
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.songs s where s.id = song_id and s.user_id = (select auth.uid())
    )
  );
create policy "jobs: el dueño los cancela" on public.jobs
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "workers: visibles para usuarios con sesión" on public.workers
  for select to authenticated using (true);

-- ─── Cola: el worker reclama el trabajo más antiguo sin pisarse con otro ────
create or replace function public.claim_next_job(p_worker text)
returns setof public.jobs
language sql
set search_path = ''
as $$
  update public.jobs j
     set status = 'separating', worker_id = p_worker, claimed_at = now()
   where j.id = (
     select q.id from public.jobs q
      where q.status = 'queued' and not q.cancel_requested
      order by q.created_at
      for update skip locked
      limit 1
   )
  returning j.*;
$$;

revoke execute on function public.claim_next_job(text) from public, anon, authenticated;
grant execute on function public.claim_next_job(text) to service_role;

-- ─── Storage: buckets privados, cada usuario en su carpeta {user_id}/ ───────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('audio', 'audio', false, 52428800,
   array['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave',
         'audio/mp4', 'audio/x-m4a', 'audio/m4a']),
  ('stems', 'stems', false, 52428800, array['audio/ogg', 'application/json'])
on conflict (id) do nothing;

create policy "audio: el dueño sube a su carpeta" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "audio: el dueño reemplaza en su carpeta" on storage.objects
  for update to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "audio y stems: el dueño lee su carpeta" on storage.objects
  for select to authenticated using (
    bucket_id in ('audio', 'stems') and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "audio y stems: el dueño borra su carpeta" on storage.objects
  for delete to authenticated using (
    bucket_id in ('audio', 'stems') and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ─── Realtime: el progreso del trabajo llega sin consultar ──────────────────
alter publication supabase_realtime add table public.jobs;

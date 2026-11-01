-- ─── DrumHero D7: historial de partidas (PLAN_V2 §3.1, D7) ───────────────────
-- Una fila por partida o rato de práctica. La racha, la meta semanal y las
-- insignias se calculan en el navegador a partir de estas filas. El id lo genera
-- el navegador: reenviar una partida no la duplica.

create table public.plays (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- id de la canción en la app (uuid de songs o id local/builtin): sin FK a propósito
  song_id text not null check (char_length(song_id) between 1 and 200),
  title text not null default '' check (char_length(title) <= 200),
  difficulty text not null check (difficulty in ('basic', 'intermediate', 'full')),
  level text not null check (level in ('beginner', 'intermediate', 'expert')),
  tempo real not null check (tempo >= 0.5 and tempo <= 1),
  score integer not null check (score >= 0),
  precision real check (precision is null or (precision >= 0 and precision <= 1)),
  -- { layer, waitMode, completed, evaluated }
  stats jsonb not null default '{}'::jsonb,
  duration_s real not null check (duration_s >= 0 and duration_s <= 86400),
  played_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index plays_user_played_idx on public.plays (user_id, played_at desc);

revoke all on public.plays from anon, authenticated;
grant all on public.plays to service_role;
grant select, delete on public.plays to authenticated;
grant insert (id, song_id, title, difficulty, level, tempo, score, precision, stats, duration_s,
  played_at) on public.plays to authenticated;

alter table public.plays enable row level security;

create policy "plays: el dueño las ve" on public.plays
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "plays: el dueño las crea" on public.plays
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "plays: el dueño las borra" on public.plays
  for delete to authenticated using ((select auth.uid()) = user_id);

-- C3: el editor guarda el chart corregido y el estado de la canción que resulta
-- (por revisar → lista). El dueño solo toca sus filas (las políticas de RLS).

grant update (data, edited) on public.charts to authenticated;
grant update (status, summary) on public.songs to authenticated;

create policy "charts: el dueño los edita" on public.charts
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Prueba de aislamiento entre usuarios (PLAN_V2 B12). Se ejecuta con el MCP de
-- Supabase (execute_sql) o en el SQL editor. Termina SIEMPRE con una excepción
-- para revertir todo: "RLS OK | …" = todas las comprobaciones pasaron.
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  s uuid := gen_random_uuid();
  n int;
  ok text := '';
begin
  insert into auth.users (id, aud, role, is_anonymous)
  values (a, 'authenticated', 'authenticated', true), (b, 'authenticated', 'authenticated', true);

  perform set_config('role', 'authenticated', true);

  -- A crea su canción y su trabajo
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.songs (id, title, file_name, audio_path, duration_s)
  values (s, 'Cancion A', 'a.mp3', a::text || '/' || s::text || '/original.mp3', 30);
  insert into public.jobs (song_id) values (s);
  select count(*) into n from public.jobs where song_id = s and status = 'queued' and jsonb_array_length(stages) = 5;
  if n <> 1 then raise exception 'A no ve su job en cola'; end if;
  ok := ok || ' | A crea cancion y job';

  -- A no puede tocar columnas que escribe el worker
  begin
    update public.songs set status = 'ready' where id = s;
    raise exception 'A cambio status';
  exception when insufficient_privilege then ok := ok || ' | A no cambia songs.status';
  end;
  begin
    insert into public.jobs (song_id, status) values (s, 'done');
    raise exception 'A creo job done';
  exception when insufficient_privilege then ok := ok || ' | A no crea jobs con status';
  end;
  begin
    update public.jobs set status = 'done' where song_id = s;
    raise exception 'A cambio jobs.status';
  exception when insufficient_privilege then ok := ok || ' | A no cambia jobs.status';
  end;
  update public.jobs set cancel_requested = true where song_id = s;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'A no puede cancelar'; end if;
  ok := ok || ' | A cancela su job';
  begin
    insert into public.songs (id, title, file_name, audio_path, duration_s)
    values (gen_random_uuid(), 'x', 'x.mp3', b::text || '/x/original.mp3', 10);
    raise exception 'A uso carpeta ajena';
  exception when check_violation then ok := ok || ' | audio_path debe ser propio';
  end;
  begin
    select count(*) into n from public.analysis_cache;
    raise exception 'A lee analysis_cache';
  exception when insufficient_privilege then ok := ok || ' | analysis_cache cerrada';
  end;
  begin
    perform public.claim_next_job('hack');
    raise exception 'A reclama jobs';
  exception when insufficient_privilege then ok := ok || ' | claim_next_job cerrada';
  end;

  -- B no ve ni toca nada de A
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.songs;
  if n <> 0 then raise exception 'B ve canciones de A'; end if;
  select count(*) into n from public.jobs;
  if n <> 0 then raise exception 'B ve jobs de A'; end if;
  update public.songs set title = 'robada' where id = s;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'B edito cancion de A'; end if;
  delete from public.songs where id = s;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'B borro cancion de A'; end if;
  begin
    insert into public.jobs (song_id) values (s);
    raise exception 'B creo job para cancion de A';
  exception when insufficient_privilege then ok := ok || ' | B no crea jobs ajenos';
  end;
  ok := ok || ' | B no ve ni edita ni borra lo de A';

  raise exception 'RLS OK%', ok;
end $$;

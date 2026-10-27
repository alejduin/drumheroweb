# Worker de análisis — DrumHero AI

Python 3.10 en Docker. Aísla la batería (Demucs `htdemucs`), detecta golpes por clase
(ADTOF Frame_RNN, port PyTorch) y estima la rejilla (beat_this `final0`).
Contratos: `../shared/chart-v2.schema.json` y `../shared/openapi.yaml`.

## Uso (desde `worker/`)

```bash
docker compose build poc                       # primera vez: ~10-20 min
docker compose run --rm poc health             # carga los 3 modelos (descarga pesos la 1.ª vez)
docker compose run --rm poc analyze poc/songs  # todas las canciones → poc/out/<id>/
docker compose run --rm poc analyze "poc/songs/Mi canción.mp3" --triplets --tolerance-ms 35
docker compose run --rm poc evaluate poc/songs # chart vs referencia (poc/references/<id>.json)
docker compose run --rm --entrypoint pytest poc -m "not models"   # tests rápidos
docker compose run --rm --entrypoint pytest poc                   # todos (incluye modelos)
docker compose run --rm --entrypoint ruff poc check . && docker compose run --rm --entrypoint ruff poc format --check .
```

### Servicio HTTP (API `/v1`, B11)

```bash
docker compose build poc        # misma imagen; tras cambiar requirements-api.txt
docker compose up worker        # http://localhost:8000 — carga los modelos al arrancar
curl localhost:8000/v1/health
curl -F "file=@poc/songs/Mi canción.mp3" localhost:8000/v1/jobs   # → 202 { jobId, status, cached }
curl localhost:8000/v1/jobs/<jobId>           # estado y etapas
curl localhost:8000/v1/jobs/<jobId>/result    # chart + stems + peaks (409 si no terminó)
curl -X DELETE localhost:8000/v1/jobs/<jobId> # cancelar
```

- `STORAGE_BACKEND=local`, sin autenticación (para la nube ver «Modo nube» abajo).
- Cola: tabla `jobs` en SQLite (`/data/jobs.sqlite3`, volumen `data`) y un consumidor que procesa
  un trabajo a la vez. Al reiniciar, lo que quedó a medias vuelve a la cola.
- Caché por sha256 del audio (`analysis_cache` + `/data/files/<sha256>/`): el mismo archivo responde
  `200 { cached: true }` al instante. Si el mismo audio ya está en proceso, se devuelve ese trabajo.
- Entrada: MP3 / WAV / M4A (se comprueba el contenido con ffprobe, no solo la extensión), ≤ 50 MB
  (`413 TOO_LARGE`), ≤ 10 min (`422 TOO_LONG`; se vuelve a medir tras decodificar).
- Privacidad: el audio subido se borra al terminar el análisis; solo quedan stems, peaks y chart.
- Cancelar en proceso corta el análisis al empezar la siguiente etapa.
- Variables: `CORS_ORIGINS` (por defecto `http://localhost:5173`), `PRELOAD_MODELS` (1 por defecto),
  `DRUMHERO_DEVICE`, `DRUMHERO_DATA_DIR`.

### Modo nube (Supabase, B12)

```bash
cp .env.example .env            # y pega la Secret key (Dashboard → Project Settings → API Keys)
docker compose up -d cloud-worker
docker compose logs -f cloud-worker
```

- La app (con `VITE_SUPABASE_*` en `.env.local`) sube el audio a `audio/{usuario}/{canción}/` y crea
  una fila en `jobs`. Este proceso (`python -m app.cloud`) la reclama con `claim_next_job` (sin
  pisarse con otro worker), analiza y deja chart + peaks en `charts` y los stems en
  `stems/{usuario}/{canción}/`. El progreso llega a la app por Realtime.
- Late cada 30 s en la tabla `workers`: la app avisa si nadie va a recoger los trabajos, pero deja
  importar igual (quedan en cola hasta que se encienda la PC).
- Caché por sha256 en `analysis_cache`: el mismo audio copia los stems sin volver a analizar.
- Al arrancar, lo que este `WORKER_ID` dejó a medias vuelve a la cola.
- La Secret key salta RLS: solo en `worker/.env` (en `.gitignore`), nunca en el navegador.
- Esquema y políticas: `supabase/migrations/`; prueba de RLS: `supabase/tests/rls_check.sql`.

- Los pesos de Demucs y beat_this se guardan en el volumen `models` (no se descargan otra vez).
- `app/`, `poc/` y `tests/` están montados: los cambios de código no requieren reconstruir.
- GPU (NVIDIA + CUDA en WSL):
  `docker compose build --build-arg TORCH_VARIANT=cu124 poc`
  y ejecutar con `DRUMHERO_DEVICE=cuda` (más `gpus: all` en el compose).

## Estructura

| Ruta | Contenido |
|------|-----------|
| `app/audio.py` | decode/encode con ffmpeg (float32 `[canales, muestras]`, 44.1 kHz) |
| `app/pipeline/separate.py` | Demucs → stems `drums` / `backing` |
| `app/pipeline/transcribe.py` | ADTOF → activaciones `[frames, 5]` a 100 fps |
| `app/pipeline/tempo.py` | beat_this → beats y downbeats en segundos |
| `app/pipeline/quantize.py` | rejilla (1/16, tresillos opcionales) y ajuste con tolerancia; colisiones |
| `app/pipeline/dynamics.py` | velocity por RMS filtrado por banda, normalizada por pieza; ghost / acento |
| `app/pipeline/chart.py` | chart v2 (`full`), limpieza de la rejilla, validación schema + invariantes |
| `app/pipeline/peaks.py` | picos de forma de onda (`peaks.json`) |
| `app/pipeline/run.py` | orquesta las etapas y registra el tiempo de cada una |
| `app/api/` | servicio FastAPI: `main` (rutas), `store` (SQLite), `queue` (consumidor), `uploads` (validación), `stages` |
| `poc/` | CLI del PoC (Fase A); `songs/` y `references/` son del usuario y no se versionan |

## Salida de `analyze`

`poc/out/<id>/` (no se versiona): `chart.json`, `drums.ogg`, `backing.ogg` (Opus 160 kbps;
`drums + backing` = mezcla original), `peaks.json` y `run.json` (tiempos por etapa, notas por pieza,
% de notas ajustadas a la rejilla).

Mapeo ADTOF → pieza: kick → `kick`, snare → `snare`, tom → `tom1`, hihat → `hihat_closed`,
cymbal → `crash`. Las demás piezas se asignan en el editor (Fase C).

## Evaluación (`evaluate`)

Compara `poc/out/<id>/chart.json` con `poc/references/<id>.json` (grabada en `/dev/record-reference`):

- Grupos: kick · snare (+ aro) · hihat (cerrado + abierto; el de pie solo con `--include-pedal`) ·
  tom (1–3) · cymbal (crash + ride).
- Estima el desfase global (±300 ms) y empareja con `mir_eval` a ±50 ms, solo dentro de los tramos grabados.
- Por canción: P / R / F1 por grupo, matriz de confusión (`—` = sin pareja), error de tiempo y
  precisión de notas con confianza ≥ / < 0.6. Global: micro y F1 medio por canción, con el criterio
  de A6 (kick, snare, hihat > 85 %). Guarda `poc/out/<id>/eval.json`.
- `--raw` evalúa los onsets sin cuantizar (`tRaw`) para medir el efecto de la cuantización.

## Licencias de modelos

- **ADTOF** (pesos del port `adtof-pytorch`, commit `85c192e`): CC BY-NC-SA 4.0 — **uso no comercial**.
  Si el producto cobra, hay que reemplazar el modelo o licenciarlo.
- Demucs: MIT. beat_this: MIT.

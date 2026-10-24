# DrumHero AI — Plan V2

> Fuente de verdad de producto: `REQUIREMENTS_V2.md`. Diseño: `design/Main.dc.html`, `design/Import.dc.html`, `design/Results.dc.html` y `design/DrumHero AI — Boceto.pdf`.
> Este documento define **cómo** se construye: arquitectura, contratos, mapa de diseño a componentes y tareas por fase con criterios de aceptación y tests.

---

## 0. Decisiones tomadas (Paso 1, aprobadas)

| # | Decisión |
|---|----------|
| D1 | **Nivel** (ventanas de acierto: Principiante / Intermedio / Experto) y **dificultad** (notas del chart: Básico / Intermedio / Completo) son ejes independientes. El nivel vive en Settings; la dificultad en el panel de configuración de la partida. |
| D2 | **Pad incorrecto** (gris): solo feedback visual. No rompe combo ni cuenta en precisión. La nota esperada se convierte en Fallo si nadie la toca dentro de la ventana. |
| D3 | **Puntos por dinámica** (opcional, toggle): +10 si una nota marcada como ghost se toca con velocity < 50, o una marcada como acento con velocity > 100. Multiplicado por el combo como el resto. |
| D4 | **Reloj maestro** = posición de reproducción del MP3 en Web Audio (`AudioContext`), compensando `outputLatency`. Los stems se reproducen como `AudioBufferSourceNode` arrancados en el mismo instante → sincronía exacta entre ellos. Un solo reloj; nadie avanza por su cuenta. |
| D5 | **Piezas**: se agrega `tom3` (MIDI 43 por defecto, confirmar en calibración). `ride_edge` (59) se mapea a `ride`. |
| D6 | **Tokens** de diseño en Tailwind v4 vía `@theme` en `src/styles/theme.css` (v4 no usa `tailwind.config`). Acento cambiable, violeta `#A78BFA` por defecto. |
| D7 | La partitura se pinta sobre fondo papel claro (`#F4F2EC`) dentro de la UI oscura, como en el boceto. |
| D8 | Maquetas a `design/`; se borran los `:Zone.Identifier` y se ignoran en `.gitignore`. |
| D9 | Sin GPU detectada en WSL: el worker corre en CPU por defecto, con imagen CUDA opcional. El objetivo de < 3 min por canción solo se valida con GPU. |
| D10 | Supabase: proyecto nuevo, creado en la Fase B. |

**Decisiones adicionales de este plan** (revisar):

| # | Decisión | Motivo |
|---|----------|--------|
| D11 | **Precisión** = (Perfecto + Cerca) / notas evaluadas. Estrellas por umbrales de precisión. | Puntuación "simple y explicada" (§8). Se muestra en un tooltip de Resultados. |
| D12 | El chart guarda la **rejilla real** (`grid.beats`, `grid.downbeats` en segundos), no solo el BPM. | Las canciones reales tienen deriva de tempo; compás y beat se derivan de la rejilla, no de un BPM constante. |
| D13 | Las dificultades Básico e Intermedio se generan con una **función TS pura** en el frontend (`generateDifficulties(full, grid)`). El worker solo emite `full`. | Después de editar el chart en el editor hay que regenerar sin volver a llamar al worker. Una sola implementación. |
| D14 | **Stems** en Opus/OGG 160 kbps. Hay un test de alineación (≤ 1 ms frente al original) en la Fase B. | Tamaño razonable para IndexedDB. Opus maneja el pre-skip y evita el desfase por *encoder delay* del MP3. |
| D15 | **Sin login para empezar**: Supabase *anonymous sign-in* da un `user_id` sin fricción y se puede vincular a un email después. | §8, principio 5. |
| D16 | El worker es agnóstico al almacenamiento: `STORAGE_BACKEND=local\|supabase`. | Se puede desarrollar y probar sin Supabase y migrar sin tocar el pipeline. |
| D17 | Velocity de cada nota = energía del onset en el stem de batería (RMS en ventana de 30 ms, normalizada a 1–127 por pieza). La confianza = pico de activación de ADTOF. | ADTOF no estima velocity. |
| D18 | En el gráfico "Precisión por compás" de Resultados se usa el color por umbral que muestra el boceto (verde ≥ 85 %, ámbar ≥ 72 %, rojo < 72 %). | El texto "más clara = más débil" de la maqueta no coincide con lo que se pinta. Prevalece lo pintado; se ajusta el subtítulo. |

---

## 1. Arquitectura final

```
┌───────────────────────────── NAVEGADOR (React 19 + TS + Vite) ─────────────────────────────┐
│                                                                                            │
│  Roland TD-02KV ──USB-MIDI──▶ MidiManager ──MidiHit{perfMs}──┐                             │
│                                                              ▼                             │
│  StemPlayer (Web Audio) ──▶ AudioClock ──songTime(s)──▶ GameEngine ──HitResult──▶ Scoring   │
│   drums.ogg / backing.ogg      │  perfToSong(perfMs)          │                    │       │
│   original.mp3 (sin stems)     │                              ▼                    ▼       │
│   metrónomo (agendado)  ◀──────┤                       StaffRenderer /       gameStore     │
│                                │                       LaneRenderer (canvas)   (Zustand)   │
│                                └──▶ SyncManager ──seek──▶ YouTube IFrame (silenciado)      │
│                                                                                            │
│  Persistencia local: IndexedDB (audio, stems, charts, peaks) · localStorage (settings)     │
│  Supabase JS: auth anónima · Storage · Postgres (songs, charts, jobs, scores)              │
└───────────────┬────────────────────────────────────────────────────────────────────────────┘
                │ 1) sube MP3 a Storage   2) POST /v1/jobs   3) Realtime/poll del estado
                ▼
┌─────────────── WORKER (Python 3.10 + FastAPI, Docker; CPU por defecto, CUDA opcional) ─────┐
│  API ──▶ cola (tabla jobs + proceso consumidor) ──▶ pipeline:                              │
│    decode (ffmpeg) → Demucs htdemucs --two-stems drums → ADTOF (5 clases)                  │
│    → beat_this (beats + downbeats) → cuantización → velocity/confianza → chart v2 (full)   │
│  Caché por sha256 del audio: si existe, devuelve el resultado sin recomputar.              │
│  Storage adapter: local (disco) | supabase (service role)                                  │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Reloj maestro (detalle crítico)

```ts
interface SongClock {
  /** Posición actual de la canción en segundos (lo que se está oyendo). */
  now(): number
  /** Convierte un timestamp performance.now() (p. ej. MIDIMessageEvent.timeStamp) a segundos de canción. */
  perfToSong(perfMs: number): number
  readonly playbackRate: number
  readonly isPlaying: boolean
}
```

- Implementación `AudioClock`: `songTime = (ctx.currentTime - startCtxTime) * rate + startOffset - outputLatency`.
- `perfToSong` usa `ctx.getOutputTimestamp()` (pares `contextTime` / `performanceTime`) para traducir de la base de `performance.now()` a la del audio. Así un golpe MIDI se evalúa con **su** timestamp real, no con el del frame.
- Latencia del kit (calibración) se resta en `HitEvaluator`; offset del video, en `SyncManager`.
- `FakeClock` para tests: el `GameEngine` pasa a ser 100 % testeable sin navegador.

### 1.2 Estructura de directorios (nueva/cambiada)

```
drumheroweb/
├── design/                     # maquetas + boceto PDF
├── shared/
│   ├── chart-v2.schema.json    # JSON Schema único: lo validan vitest y pytest
│   ├── openapi.yaml            # contrato de la API del worker
│   └── examples/               # charts de ejemplo usados por los tests de ambos lados
├── worker/
│   ├── poc/                    # Fase A: scripts + songs/ (gitignored) + REPORT.md
│   ├── app/                    # Fase B: FastAPI
│   │   ├── main.py  api.py  jobs.py  storage.py
│   │   └── pipeline/ separate.py transcribe.py tempo.py quantize.py dynamics.py chart.py
│   ├── tests/
│   ├── Dockerfile  Dockerfile.cuda  docker-compose.yml  pyproject.toml
├── supabase/migrations/
└── src/
    ├── styles/theme.css        # @theme tokens
    ├── audio/                  # AudioClock, StemPlayer, Mixer, peaks
    ├── chart/                  # ChartParser v2, v1→v2, difficulties, grid utils
    ├── engine/                 # GameEngine v2, HitEvaluator v2, Metronome v2
    ├── renderer/               # StaffRenderer, LaneRenderer, EffectsRenderer, layout puros
    ├── scoring/                # ScoreManager v2, ComboSystem, analytics (compases débiles)
    ├── youtube/                # YouTubePlayer, SyncManager
    ├── api/                    # cliente del worker, supabase client
    ├── storage/                # IndexedDB (songs, blobs, charts)
    ├── store/                  # gameStore, settingsStore, progressStore, libraryStore
    └── ui/ screens/ components/ primitives/
```

---

## 2. Chart v2

### 2.1 Tipos (TS, `src/types/chart.ts`)

```ts
type Piece =
  | 'kick' | 'snare' | 'snare_rim'
  | 'hihat_closed' | 'hihat_open' | 'hihat_pedal'
  | 'tom1' | 'tom2' | 'tom3'
  | 'crash' | 'ride'

type Dynamic = 'ghost' | 'normal' | 'accent'

interface ChartNote {
  t: number            // segundos desde el inicio del MP3 (fuente de verdad), ya cuantizado
  piece: Piece
  velocity: number     // 1–127
  confidence: number   // 0–1; < 0.6 = "por revisar"
  dynamic?: Dynamic    // derivado de velocity si falta
  tRaw?: number        // onset sin cuantizar (para recuantizar en el editor)
}

interface ChartV2 {
  version: 2
  id: string
  title: string
  artist: string
  bpm: number                       // tempo medio (mostrar/editar)
  timeSignature: [number, number]
  durationS: number
  audioUrl: string | null           // storage://… o idb://…
  stems: { drums: string; backing: string } | null
  audioSha256: string | null
  youtubeUrl: string | null
  youtubeOffsetMs: number
  grid: { beats: number[]; downbeats: number[] }   // segundos
  difficulties: {
    basic: { notes: ChartNote[] }
    intermediate: { notes: ChartNote[] }
    full: { notes: ChartNote[] }
  }
  sections: { name: string; startMeasure: number; endMeasure: number }[]
  source: { kind: 'ai' | 'manual' | 'builtin'; model?: string; createdAt: string }
}
```

Reglas: notas ordenadas por `t`; compás y beat de una nota = búsqueda binaria en `grid`; `measure` es base 1 (primer downbeat = compás 1). Los charts v1 de `public/songs` se convierten con `convertV1ToV2()` (rejilla sintética a BPM constante).

### 2.2 JSON Schema

`shared/chart-v2.schema.json` es el contrato. Lo valida `ChartParser` (frontend, con un validador ligero propio o `ajv`) y `pytest` (con `jsonschema`) sobre cada chart que emite el worker.

---

## 3. Contrato de la API del worker (`/v1`)

Fuente de verdad: `shared/openapi.yaml` (espejo TS en `src/types/api.ts`).

Autenticación: `Authorization: Bearer <JWT de Supabase>`; en modo local, desactivada. CORS solo para `http://localhost:5173` y el dominio de la app.

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/v1/health` | `{ status: "ok", device: "cpu"\|"cuda", models: {demucs, adtof, beat_this} }` |
| `POST` | `/v1/jobs` | Crea un análisis. Cuerpo JSON `{ audioPath, sha256, title, artist, durationS }` (modo Supabase) o `multipart/form-data` con `file` (modo local). Responde `202 { jobId, status, cached }`. Si el `sha256` ya está analizado → `200 { jobId, status: "done", cached: true }`. |
| `GET` | `/v1/jobs/{jobId}` | Estado del trabajo (ver abajo). |
| `GET` | `/v1/jobs/{jobId}/result` | `200 { chart: ChartV2, stems: { drums, backing }, peaks }` solo si `status = done`; si no, `409`. |
| `GET` | `/v1/files/{path}` | Solo modo local: sirve stems y peaks. |
| `DELETE` | `/v1/jobs/{jobId}` | Cancela si está en cola o en proceso; `204`. |

**Validación de entrada:** MP3/WAV/M4A, ≤ 10 min (se mide tras decodificar), ≤ 50 MB. Si falla → `422 { error: { code, message } }`.

**Estados del trabajo:**

```
queued → separating → transcribing → tempo → quantizing → finalizing → done
                    ↘──────────────── failed (con error.code) ─────────────────↗
                    ↘──────────────── canceled
```

```json
{
  "jobId": "b8e1…",
  "status": "transcribing",
  "stages": [
    { "id": "separate",   "label": "Separar la batería del resto", "state": "done",    "progress": 1.0 },
    { "id": "transcribe", "label": "Detectar golpes por pieza",    "state": "running", "progress": 0.62 },
    { "id": "tempo",      "label": "Detectar tempo y compases",    "state": "pending", "progress": 0 },
    { "id": "quantize",   "label": "Cuantizar a la rejilla",       "state": "pending", "progress": 0 },
    { "id": "difficulties","label": "Generar 3 dificultades",      "state": "pending", "progress": 0 }
  ],
  "summary": null,
  "error": null,
  "createdAt": "…", "updatedAt": "…"
}
```

- `summary` al terminar: `{ bpm, timeSignature, pieces: Piece[], lowConfidenceCount, lowConfidenceByPiece }` → alimenta las 3 tarjetas de la pantalla Importar.
- La etapa `difficulties` se completa en el cliente (D13); el worker la reporta como `done` al entregar `full`.
- Códigos de error: `UNSUPPORTED_FORMAT`, `TOO_LONG`, `TOO_LARGE`, `DECODE_FAILED`, `SEPARATION_FAILED`, `TRANSCRIPTION_FAILED`, `NO_DRUMS_DETECTED`, `NOT_READY`, `NOT_FOUND`, `UNAUTHORIZED`, `INTERNAL`. Formato: `{ "error": { "code", "message" } }`.
- Notificación: Supabase Realtime sobre la fila `jobs`; *fallback* polling cada 2 s. Notificación del navegador (`Notification API`) al terminar si el usuario lo permite.

### 3.1 Supabase (Fase B)

| Tabla | Columnas clave |
|-------|----------------|
| `songs` | `id, user_id, title, artist, audio_path, audio_sha256, duration_s, youtube_url, youtube_offset_ms, status ('analyzing'\|'ready'\|'needs_review'\|'failed'), created_at` |
| `charts` | `song_id, version, data jsonb, edited bool, updated_at` |
| `jobs` | `id, song_id, user_id, status, stages jsonb, summary jsonb, error jsonb, …` |
| `analysis_cache` | `audio_sha256 PK, chart jsonb, drums_path, backing_path, peaks_path` (solo service role) |
| `plays` (Fase D) | `id, user_id, song_id, difficulty, level, tempo, score, precision, stats jsonb, duration_s, played_at` |

Buckets privados `audio/` y `stems/` con ruta `{user_id}/…`. RLS: cada usuario solo ve sus filas. Las rutas de Storage no se comparten entre usuarios aunque coincida el hash (la caché copia los archivos al espacio del usuario).

---

## 4. Mapa de diseño a componentes

### 4.1 Tokens (`src/styles/theme.css`)

```
--color-bg #0B0C10        --color-surface-header #101117   --color-surface #13141B
--color-surface-2 #171922 --color-surface-inset #0E0F14    --color-track #262938
--color-border #22252F    --color-border-strong #2E3240    --color-border-dashed #3A3E4D
--color-fg #ECEDF2        --color-fg-2 #C9CCD8             --color-muted #9AA0B4   --color-faint #6B6F7E
--color-accent #A78BFA    --color-accent-soft #221E35      --color-on-accent #15161C
--color-perfect #10B981   --color-perfect-fg #34D399       --color-perfect-bg #13261F  --color-perfect-border #1E4A39  --color-perfect-text #A7F3D0
--color-close #D97706     --color-close-fg #FBBF24         --color-close-bg #2A2312    --color-close-border #5C4710    --color-close-text #FDE68A
--color-miss #DC2626      --color-wrong #9AA0B4
--color-paper #F4F2EC     --color-paper-ink #2A2C35        --color-paper-future #1C1D24  --color-paper-chip #E4E1D8  --color-paper-muted #4B4F5E
--font-sans "Archivo"     --font-mono "JetBrains Mono"
--radius-xl 16px  --radius-lg 14px  --radius-md 10px  --radius-sm 8px
```

El canvas lee los mismos valores desde `src/constants/theme.ts`, generado a mano desde los tokens; un test verifica que los dos coinciden. Etiquetas de sección: `text-[11px] tracking-[0.08em] uppercase text-muted`.

### 4.2 Primitivas (`src/ui/primitives/`)

`Button` (variantes `primary`/`secondary`/`light`/`warning`), `IconButton`, `SegmentedControl` (oscuro y papel), `Slider`, `Checkbox`/`Toggle`, `Panel`, `StatTile`, `Chip`, `StatusPill`, `ProgressBar`, `StepRow`, `Legend`, `Stars`.

### 4.3 Pantalla de juego (`design/Main.dc.html`)

| Zona | Componente | Notas |
|------|-----------|-------|
| Header (64 px) | `GameHeader` | contiene lo de abajo |
| ↳ Pausa | `IconButton` → `useTransport().toggle` | También un pad configurable del kit sirve de play/pausa |
| ↳ Título + meta "Intermedio · 104 BPM · 4/4 · transcrita por IA" | `SongTitleBlock` | |
| ↳ Barra de progreso + `1:24 / 3:23` | `SongProgress` | se actualiza vía ref en RAF, sin re-render |
| ↳ PUNTOS / COMBO ×n / PRECISIÓN | `HudStats` (`StatTile` compacto) | selectores Zustand; cambian por golpe, no por frame |
| ↳ "TD-02KV conectado" | `MidiStatusPill` | reusa `useMidi` |
| Partitura (300 px, papel) | `ScorePanel` | |
| ↳ canvas | `GameCanvas` → `StaffRenderer` \| `LaneRenderer` + `EffectsRenderer` | línea de golpe ~17 % del ancho, 3–4 s visibles a la derecha |
| ↳ Pentagrama / Carriles | `SegmentedControl variant="paper"` | `settingsStore.view` |
| ↳ "PERFECTO +100" | dibujado en canvas (`EffectsRenderer.drawJudgementBadge`) | mismo frame que el MIDI |
| ↳ Medidor ‹ Temprano / Tarde › + "vas +14 ms tarde" | `TimingMeter` | promedio de los últimos 16 golpes |
| ↳ Leyenda Perfecto ±30 / Cerca ±80 / Fallo | `JudgementLegend` | valores del nivel activo |
| Video (640×360) | `VideoPanel` → `YouTubePlayer` | chip "silenciado · sincronizado +42 ms"; botón ocultar (tecla `V`); placeholder si no hay URL |
| Secciones | `SectionsPanel` | precisión por sección en vivo; fila actual con borde de acento; CTA `Practicar compases X–Y al N%` |
| Transporte | `TransportBar` | play/pausa, nombre "· reloj maestro", tiempo `m:ss.mmm`, chips Loop A–B / Tempo / Cuenta 1 compás |
| ↳ Forma de onda + cursor + región loop | `Waveform` (canvas, peaks precalculados) | clic = seek; arrastrar = loop A–B |
| ↳ Etiquetas de sección | `SectionRuler` | |
| Panel derecho | `SessionSettingsPanel` | |
| ↳ DIFICULTAD | `SegmentedControl` | Básico/Intermedio deshabilitados hasta la Fase D |
| ↳ TEMPO + rampa | `Slider` + `Checkbox` | Fase D |
| ↳ MEZCLADOR (Batería original, Backing, Metrónomo) + preset | `MixerPanel` (`Slider` ×3) | |
| ↳ SINCRONÍA (offset video, latencia kit, Recalibrar) | `SyncSummary` | abre `CalibrationScreen` |
| ↳ Modo espera / Puntos por dinámica | `Checkbox` | modo espera en la Fase D |

**Notación en `StaffRenderer`** (según el boceto): 5 líneas; hi-hat = X sobre la línea superior; crash = X con línea adicional; ride = X en la línea superior; caja = cabeza llena en el 3.er espacio; bombo = cabeza llena en el 1.er espacio; toms en el 4.º espacio, la 4.ª línea y el 2.º espacio; hi-hat abierto = "o" encima; hi-hat de pie = X bajo el pentagrama; ghost = cabeza pequeña, tenue, entre "( )"; acento = ">". Plicas hacia arriba con barras por beat; número de compás bajo la barra de compás. Color por estado: futuro `paper-future`, Perfecto verde, Cerca ámbar + etiqueta "temprano/tarde", Fallo rojo + "fallo"; resplandor verde y rayos en la línea de golpe.

### 4.4 Importar (`design/Import.dc.html`)

| Zona | Componente |
|------|-----------|
| Kicker "NUEVA CANCIÓN" + H1 | `PageHeader` |
| Área de soltar archivo | `AudioDropzone` (valida tipo y duración en el cliente con `decodeAudioData`) |
| URL de YouTube + ayuda | `YouTubeUrlField` (valida el id) |
| Título / Artista | `TextField` ×2 (rellenados desde ID3 si existen) |
| "Analizar con IA" | `Button primary` |
| Panel "Analizando…" | `AnalysisPanel` |
| ↳ 5 etapas | `StepRow` ×5 (estados `done` / `running` / `pending` / `failed`) |
| ↳ TEMPO / PIEZAS / POR REVISAR | `StatTile` ×3 (POR REVISAR con la variante `close`) |
| ↳ Revisar en el editor / Sincronizar video / Jugar ahora | `Button` ×3 → `EditorScreen` / `SyncWizard` / `GameScreen` |

### 4.5 Resultados (`design/Results.dc.html`)

| Zona | Componente |
|------|-----------|
| Kicker "CANCIÓN · NIVEL · TEMPO" + titular | `ResultsHeader` (titular generado: `buildHeadline(stats, previous)`) |
| Estrellas | `Stars` |
| PUNTOS / PRECISIÓN / MEJOR COMBO / TIMING | `StatTile` ×4 con subtítulo contextual (récord, anterior, sección, tendencia) |
| Distribución de golpes | `DistributionBar` + `Legend` |
| Por pieza (Bombo, Caja, Hi-hat, Toms, Platillos) | `PieceAccuracyGrid` (agrupa piezas) |
| Precisión por compás + secciones | `MeasureHeatmap` + `SectionRuler` |
| CTA "Practicar compases X–Y (pieza) al N%" / "Reintentar al N%" | `Button` ×2 (`findWeakestMeasures`) |
| Racha + meta semanal | `StreakSummary` |

### 4.6 Otras pantallas (sin maqueta; mismos tokens y primitivas)

`HomeScreen` (Continuar, racha y meta, Biblioteca, Importar), `LibraryScreen` (estados *Analizando*, *Lista*, *Requiere revisión*), `EditorScreen`, `CalibrationScreen` (latencia del kit + mapeo MIDI), `SyncWizard`, `SettingsScreen` (nivel, vista, velocidad de scroll, acento, dispositivo MIDI).

---

## 5. Reutilizar / modificar / nuevo (resumen)

| Módulo | Acción |
|--------|--------|
| `midi/MidiManager`, `midiMap`, `hooks/useMidi`, `MidiConnectionToast`, `BrowserWarning` | **Reusar**. Quitar el `console.log` por mensaje; añadir `tom3`; `59 → ride`. |
| `scoring/ComboSystem` | **Reusar** (el Fallo rompe el combo; el pad incorrecto no). |
| `types`, `constants/game` | **Modificar**: `Piece`, `Judgement = perfect\|close\|miss`, `LEVEL_WINDOWS`, `LEVEL_POINTS`. |
| `engine/HitEvaluator` | **Modificar**: nivel, temprano/tarde, `wrong_pad`, dinámica. |
| `engine/GameEngine` | **Reescribir** sobre `SongClock`: seek, loop, modo espera, fin por duración. |
| `engine/SongParser` | **Reemplazar** por `chart/ChartParser` + `convertV1ToV2`. |
| `engine/Metronome` | **Reescribir**: clicks agendados en el `AudioContext` del `StemPlayer` a partir de `grid.beats`. |
| `scoring/ScoreManager`, `store/*` | **Ampliar**. |
| `renderer/*` | `NoteRenderer` → `LaneRenderer`; nuevo `StaffRenderer`; `EffectsRenderer` adaptado; `HUDRenderer` se elimina (HUD en DOM). |
| `ui/screens/*` | Game y Results rehechas; Home y Settings reestilizadas; SongSelect → Library. |
| `audio/`, `youtube/`, `chart/`, `api/`, `storage/`, `worker/`, `supabase/` | **Nuevo**. |

---

## 6. Tareas por fase

Convención: cada tarea = una feature = uno o más commits convencionales. **Hecho** = typecheck + lint (0 warnings) + tests en verde + criterios de aceptación verificados. Frontend: Vitest (lógica pura; RTL solo para primitivas interactivas). Worker: pytest. Lo que requiere hardware (MIDI real, latencia, audio) se valida con una **prueba manual guiada** que te pediré.

### Fase 0 — Preparación (½ día)

| Tarea | Aceptación | Tests |
|-------|-----------|-------|
| **0.1** Mover maquetas a `design/`, borrar `:Zone.Identifier`, `.gitignore` (`*:Zone.Identifier`, `worker/poc/songs/`, `worker/poc/out/`, `.venv`). | Repo limpio; `git status` sin basura. | — |
| **0.2** `npm install`, activar Husky (`.husky/pre-commit` → lint-staged), baseline de typecheck/lint/tests. | Los 3 comandos pasan; el hook corre en un commit. | Tests existentes en verde (o arreglados). |
| **0.3** Actualizar `CLAUDE.md` a V2 (ventanas §6.5, reloj maestro, estructura, comandos del worker). | Sin referencias a ventanas v1. | — |

### Fase A — Prueba de concepto de IA (1–2 semanas)

Objetivo: decidir si la transcripción es suficientemente buena (bombo, caja y hi-hat > ~85 % de F1) y fijar los contratos.

| Tarea | Aceptación | Tests |
|-------|-----------|-------|
| **A1** `shared/chart-v2.schema.json` + `src/types/chart.ts` + contrato OpenAPI `shared/openapi.yaml` + `src/types/api.ts` + `validateChartInvariants` (secciones 2 y 3). | El schema valida un chart de ejemplo y rechaza los inválidos; los tipos TS compilan. | vitest: ejemplos válidos e inválidos contra el schema. |
| **A2** Imagen Docker del PoC (`python:3.10-slim`, ffmpeg, torch CPU, `demucs`, `ADTOF`, `beat_this`); `Dockerfile.cuda` opcional. Comando `docker compose run poc analyze songs/<x>.mp3`. | `health` lista los modelos; la imagen construye desde cero; los pesos se cachean en un volumen. | pytest: smoke test con un WAV sintético de 5 s. |
| **A3** Pipeline: decode → Demucs (`--two-stems drums`) → ADTOF → beat_this → cuantización a la rejilla (1/16 por defecto, tresillos opcionales) → velocity y confianza → `chart.json` v2 (`full`) + `drums.ogg` + `backing.ogg` + `peaks.json`. | Para cada canción de `songs/`, genera un chart válido según el schema; registra el tiempo por etapa. | pytest: `quantize` (snap, tolerancia, colisiones), `dynamics` (normalización), `chart` (orden, schema), mapeo de clases ADTOF → `Piece` (5 clases: kick, snare, hihat_closed, tom1, crash). |
| **A4** Herramienta de referencia: ruta de desarrollo `/dev/record-reference` en el frontend: reproduce el MP3 con `AudioClock` (adelanta la tarea B4) y graba los golpes de la TD-02KV en segundos de canción → `reference.json`. Alternativa: importar MIDI o Guitar Pro → `reference.json` con alineación automática por correlación de bombos. | Grabas 1 canción; el JSON contiene tus golpes con tiempos coherentes (prueba manual guiada). | vitest: `AudioClock.perfToSong` con `FakeAudioContext`; conversión MIDI → referencia (pytest con `pretty_midi`). |
| **A5** Evaluador: `poc evaluate songs/<x>` compara chart vs referencia con `mir_eval` (ventana ±50 ms, tras estimar el offset global) → precision/recall/F1 por pieza agrupada, más una matriz de confusión entre piezas. | Tabla por canción y global. | pytest: evaluador con datos sintéticos (casos perfectos, desplazados y con confusión). |
| **A6** `worker/poc/REPORT.md`: resultados en las 5 canciones, tiempos CPU (y GPU si hay), errores típicos y recomendación **seguir / ajustar / Klangio**. | **Criterio de avance**: F1 > 0.85 en bombo, caja y hi-hat (media de las 5). Si no se cumple, se discute antes de la Fase B. | — |

### Fase B — Juego con chart propio (2–3 semanas)

| Tarea | Aceptación | Tests |
|-------|-----------|-------|
| **B1** Tokens `@theme` + fuentes (Archivo, JetBrains Mono, auto-hospedadas con `@fontsource`) + primitivas UI. | Una página `/dev/ui` muestra todas las primitivas en sus estados. | RTL: `Slider` (teclado y aria), `SegmentedControl` (selección y teclado), `Checkbox`; test de paridad tokens CSS ↔ `constants/theme.ts`. |
| **B2** Dominio v2: `Piece`, `Judgement`, `LEVEL_WINDOWS`/`LEVEL_POINTS`, `ChartParser`, `convertV1ToV2`, utilidades de rejilla (`timeToMeasureBeat`, `measureRange`). Migrar `public/songs` a v2. `midiMap`: `tom3`, `59→ride`; quitar el `console.log`. | Las canciones incluidas cargan como v2. | vitest: parser (válidos e inválidos), conversión v1→v2 (tiempos idénticos), rejilla con tempo variable, midiMap. |
| **B3** `HitEvaluator` v2: ventanas por nivel (límites inclusivos), signo temprano/tarde, `wrong_pad`, bonus de dinámica, selección de la nota candidata más cercana de la misma pieza (hi-hat de pie cuenta). | Rendimiento: evaluar 10 000 golpes sobre un chart de 2 000 notas < 5 ms por golpe en promedio. | vitest: tabla de límites ±20/45/50/80/110 por nivel, temprano/tarde, pad incorrecto, dinámica, benchmark. |
| **B4** `audio/`: `AudioClock`, `StemPlayer` (carga y decodificación; play, pausa y seek; stems sincronizados; fallback al MP3 original sin stems), `Mixer` (ganancias de batería, backing, metrónomo y samples; preset "Tocar yo la batería": batería 0 %, backing 80 %, metrónomo 40 %). | Pausa/reanuda y seek sin desfase entre stems (prueba manual); `now()` es monótono durante la reproducción. | vitest con `FakeAudioContext`: `now()`, `perfToSong`, seek, pausa, rate; mixer (presets y clamps). **Test de alineación** (pytest): stems decodificados vs original, desfase ≤ 1 ms. |
| **B5** `GameEngine` v2 sobre `SongClock`: ventana de notas pendientes, Fallos al expirar, eventos `onJudgement`, fin por `durationS`, seek (reconstruye el estado), loop A–B (se usa en D). | Una partida completa con chart de prueba y `FakeClock` produce las mismas estadísticas que el cálculo esperado. | vitest: escenarios con `FakeClock` (todo perfecto, todo fallo, mezcla, seek hacia atrás, notas simultáneas kick + hihat). |
| **B6** Scoring v2: `ScoreManager` (puntos × combo, precisión D11, por pieza agrupada, por compás, por sección, mejor combo y dónde, tendencia de 16 golpes) + `gameStore` (selectores; nada de actualizaciones por frame). | — | vitest: puntos por nivel (Experto Cerca = 40), multiplicadores en 9/10/24/25/49/50, agregados por compás y sección, tendencia. |
| **B7** Renderers: `staffLayout` puro (pieza → posición y cabeza; tiempo → x; agrupación de barras por beat; ghost y acento), `StaffRenderer`, `LaneRenderer`, `EffectsRenderer` (resplandor y rayos en la línea, badge de juicio, colores por estado). | 60 fps con 2 000 notas (prueba de rendimiento manual con DevTools); el destello se pinta en el mismo frame del golpe. | vitest: `staffLayout` (posiciones por pieza, culling, agrupación de barras, compases), layout de carriles. |
| **B8** `GameScreen` según §4.3 (todo salvo video y las funciones de la Fase D, que quedan deshabilitadas) + `Waveform` desde `peaks.json` + `TimingMeter` + `SectionsPanel`. | Layout fiel al boceto a 1440×960; seek por clic en la onda; tecla Espacio = pausa. | vitest: cálculo del medidor (promedio y clamp), formato de tiempos, precisión de sección. |
| **B9** `Metronome` v2 agendado en el `AudioContext` desde `grid.beats` (sin `setInterval` como reloj; el *scheduler* usa `requestAnimationFrame` + lookahead). | Clicks alineados al beat al pausar, reanudar y hacer seek (prueba manual). | vitest: `beatsInWindow(grid, from, to)`, acentos de downbeat. |
| **B10** `CalibrationScreen`: latencia del kit (8 golpes con click, se descarta el peor y se promedia) + mapeo MIDI por pieza. | Valor guardado y aplicado; repetibilidad ±5 ms en 3 corridas (prueba manual). | vitest: `computeLatency(samples)` (outliers, mínimo de muestras). |
| **B11** Worker FastAPI (`worker/app`): endpoints de la §3, cola (tabla `jobs` + consumidor), progreso por etapa, caché por sha256, `STORAGE_BACKEND=local`, límites de entrada. `docker compose up worker`. | Subir un MP3 desde `curl` → `done` con chart válido; mismo archivo otra vez → `cached: true` instantáneo. | pytest: API con pipeline falso (estados, 409, 422, cancelación, caché), validación de entrada. |
| **B12** Supabase: proyecto, migraciones (§3.1), buckets privados, RLS, auth anónima; `STORAGE_BACKEND=supabase` en el worker; cliente en `src/api/supabase.ts`. | Un usuario no ve canciones de otro (prueba con 2 sesiones anónimas); los *advisors* de seguridad sin errores. | pytest: adapter de storage (mock); SQL de políticas probado con `execute_sql` en branch. |
| **B13** `ImportScreen` + `LibraryScreen` + `libraryStore` + caché IndexedDB (audio, stems, chart y peaks; sirve sin conexión). | Flujo completo: soltar MP3 → progreso real → "Jugar ahora"; la canción queda en la biblioteca con su estado; recargar sin red y jugar una canción ya analizada. | vitest: máquina de estados del cliente del job (poll/realtime, errores, reintento), validación del dropzone, repositorio IDB con `fake-indexeddb`. |
| **B14** `ResultsScreen` según §4.5 + `progressStore` v2 (mejor puntuación y precisión anterior). | Muestra datos reales de la partida; CTA a compases débiles (preparado para D). | vitest: `findWeakestMeasures`, `buildHeadline`, estrellas por precisión, agrupación por pieza. |
| **B15** `HomeScreen` (Continuar con la última canción, sección, tempo y filtros) + `SettingsScreen` reestilizada (nivel, vista, velocidad de scroll, acento). | La última sesión se restaura tras recargar. | vitest: persistencia de la sesión. |

### Fase C — YouTube y editor (2–3 semanas)

| Tarea | Aceptación | Tests |
|-------|-----------|-------|
| **C1** `YouTubePlayer` (IFrame API, siempre `mute()`, sin controles de audio) + `SyncManager`: interpola el tiempo del video con `performance.now()`; si `|deriva| > 40 ms` → `seekTo`; sigue pausa, seek, loop y rate del reloj maestro; tecla `V` oculta el video. | En una canción de 3 min la deriva medida se mantiene < 40 ms (log de depuración); el video nunca suena. | vitest: `computeDrift`, histéresis de la corrección, mapeo de estados del reproductor; parser de URLs de YouTube. |
| **C2** `SyncWizard`: reproduce el video y pide pulsar un pad en el primer golpe de bombo → offset; ajuste fino ±5 ms con vista previa. Se guarda en el chart (`youtubeOffsetMs`). | El offset persiste; el chip "sincronizado +N ms" lo refleja. | vitest: cálculo del offset (media de N toques, descarte de outliers). |
| **C3** `EditorScreen`: timeline de la partitura completa (reusa `staffLayout`), notas con confianza < 0.6 resaltadas y lista "por revisar"; seleccionar, agregar, borrar, mover y cambiar pieza; recuantizar una sección (resolución elegible, usa `tRaw`); deshacer/rehacer; guardar (local + Supabase) y regenerar dificultades (D13, cuando exista). | Editar y guardar; la partida usa el chart editado; `songs.status` pasa de `needs_review` a `ready`. | vitest: reducer del editor (cada operación, undo/redo, recuantizar), serialización válida contra el schema. |
| **C4** "Escuchar la transcripción": samples del kit (en `public/samples`) agendados sobre el reloj, con mezcla contra el audio original. | Se oye la transcripción alineada con la canción. | vitest: agenda de notas en ventana (sin duplicados al hacer seek). |
| **C5** "Grabar con mi kit": se elige un rango de compases, cuenta de 1 compás, se graba la MIDI y se reemplazan las notas del rango (cuantizadas). | El pasaje grabado sustituye al original y se puede deshacer. | vitest: `replaceRange(chart, from, to, hits)` + cuantización. |

### Fase D — Aprendizaje (3–4 semanas)

| Tarea | Aceptación | Tests |
|-------|-----------|-------|
| **D1** `generateDifficulties`: Básico (bombo y caja en tiempos fuertes + hi-hat en negras), Intermedio (hi-hat en corcheas, fills reducidos a caja, sin ghost notes), Completo. Se habilita el selector. | Los 3 niveles se pueden tocar y tienen una densidad creciente coherente. | vitest: reglas por dificultad sobre grooves conocidos (rock, shuffle, fill). |
| **D2** Tempo 50–100 % sin cambio de tono: time-stretch (spike entre `soundtouchjs` en AudioWorklet y pre-render offline con `rubberband-wasm`; se elige por calidad y latencia). El reloj escala con `rate`. | A 75 % las notas siguen sincronizadas y el tono no cambia (prueba manual). | vitest: escalado del reloj y de las ventanas (las ventanas se miden en tiempo real, no de canción). |
| **D3** Loop A–B por compases (desde la onda o desde Resultados), cuenta de 1 compás al empezar o reanudar, rampa +5 % al lograr ≥ 90 % en una vuelta. | Practicar compases 12–15 al 75 % con la rampa funciona de punta a punta. | vitest: máquina de estados de loop y rampa; generación de la cuenta. |
| **D4** Modo espera: el reloj se detiene en la siguiente nota hasta el golpe correcto. | — | vitest: `GameEngine` con `FakeClock` en modo espera. |
| **D5** Práctica por capas: bombo y caja → + hi-hat → kit completo. | — | vitest: filtro por capas. |
| **D6** Mapa de calor por compás y "Practicar mis 4 compases más débiles" (desde Resultados y desde el panel de Secciones). | El CTA abre el loop correcto al tempo sugerido. | vitest: `findWeakestMeasures` con empates y bordes. |
| **D7** Historial (`plays`), racha diaria, meta semanal en minutos, insignias por hitos (primer 100 % en un groove, 7 días seguidos) — Supabase con fallback local. | Visibles en Home y Resultados; sobreviven a reinstalar si hay sesión. | vitest: cálculo de racha (zonas horarias, días saltados), meta semanal, reglas de insignias. |
| **D8** Perfil de latencia por dispositivo, PWA (service worker para el shell y IDB para el contenido) y pase de rendimiento (60 fps, < 5 ms por golpe, < 10 ms de desfase). | Checklist de §10 verificado con hardware real. | — |

---

## 7. Riesgos específicos del plan

| Riesgo | Mitigación |
|--------|-----------|
| ADTOF solo da 5 clases (no distingue hi-hat abierto/cerrado, crash/ride ni los toms entre sí). | Mapeo por defecto (hihat → closed, cymbals → crash, toms → tom1) + editor. En la Fase A se mide la confusión; se evalúa luego un clasificador por pieza (p. ej. separación con LarsNet). |
| Dependencias de ADTOF (TensorFlow) frente a versiones modernas de Python. | Imagen Docker fijada a Python 3.10 y versiones exactas; no se instala en el host. |
| Desfase por *encoder delay* entre MP3 y stems. | Decodificación con ffmpeg en el worker; stems en Opus; test de alineación (B4). |
| `getOutputTimestamp`/`outputLatency` imprecisos según el driver. | La calibración del kit absorbe el residuo; se mide en la Fase A con A4. |
| CPU lenta para el análisis. | Caché por hash; imagen CUDA opcional; progreso honesto por etapa. |
| YouTube: tiempo poco granular, anuncios, video distinto de la versión del MP3. | Interpolación + corrección > 40 ms; si hay anuncio, se pausa el juego; el asistente de offset por canción. |

---

## 8. Lo que necesito de ti para la Fase A

- **5 canciones** (MP3 o WAV de 2–5 min, estilos variados: rock o pop simple, una con mucho hi-hat, una con fills de toms, una con mezcla densa y una rápida) en `worker/poc/songs/` (gitignored).
- **Referencia** por canción: MIDI o Guitar Pro si lo tienes; si no, la grabamos tocando con la TD-02KV usando la herramienta A4.
- Docker Desktop con integración WSL activo (ya detectado: Docker 29.6).

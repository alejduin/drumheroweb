# DrumHero — Plan Técnico

> Referencia de arquitectura. El orden de implementación está en la sección 6.

---

## 1. Decisiones Arquitecturales

### ¿Por qué Canvas 2D y no DOM/SVG?
El renderizado de notas scrollando a 60fps con potencialmente 100+ notas simultáneas requiere control total del pipeline de dibujo. React re-renders del DOM introducirían jank. El canvas se maneja con un loop RAF independiente de React.

### ¿Por qué Zustand y no Context/Redux?
El estado del juego cambia decenas de veces por segundo (score, combo, posición). Redux añade overhead de serialización. Context provoca re-renders en cascada. Zustand permite suscripciones selectivas y mutación directa.

### ¿Por qué Web MIDI API nativa?
Cualquier librería wrapper añade al menos un tick de event loop (~1-4ms). El requisito es <10ms de latencia total. La API nativa en Chrome nos da acceso directo al stream MIDI del OS.

### ¿Por qué Tone.js solo para metrónomo?
El audio del metrónomo necesita scheduling preciso (ahead-of-time). Tone.js usa Web Audio API con scheduling a futuro, que evita glitches de audio por jank de UI.

---

## 2. Dependencias

### Runtime
```
react@^19
react-dom@^19
typescript@^6
zustand@^5
tone@^15
tailwindcss@^4
```

### Dev / Tooling
```
vite@^8
@vitejs/plugin-react
@tailwindcss/vite
vitest@^3
@testing-library/react
@testing-library/user-event
@testing-library/jest-dom
eslint@^9
@typescript-eslint/eslint-plugin
@typescript-eslint/parser
eslint-plugin-react-hooks
prettier@^3
husky@^9
lint-staged@^15
```

---

## 3. Flujo de Datos

```
Roland TD-02KV
     │ USB-MIDI
     ▼
Web MIDI API (browser)
     │ MIDIMessageEvent (canal 10, noteOn/noteOff)
     ▼
MidiManager.ts
     │ Emite: { instrument, velocity, timestamp: performance.now() }
     ▼
GameEngine.ts  ←── RAF loop (60fps) ──► ScoreRenderer.ts
     │                                        │
     │ HitEvaluator.evaluate(hit, song)        │ NoteRenderer.draw()
     ▼                                        │ HUDRenderer.draw()
ScoreManager.ts                              │ EffectsRenderer.draw()
     │                                        ▼
     ▼                                   <canvas>
gameStore (Zustand)
     │
     ▼
React UI (re-renders solo al cambiar de pantalla, NO en cada frame)
```

**Regla clave:** React NO se re-renderiza en cada frame. El canvas es imperativo. Zustand notifica a React solo cuando cambia la pantalla (Game → Results) o el score para el HUD de alto nivel.

---

## 4. Modelo de Tipos (`src/types/index.ts`)

```typescript
export type DrumInstrument =
  | 'kick' | 'snare' | 'snare_rim'
  | 'hihat_closed' | 'hihat_open' | 'hihat_pedal'
  | 'tom1' | 'tom2'
  | 'crash' | 'ride' | 'ride_edge'

export enum HitAccuracy {
  Perfect = 'perfect',  // ±30ms
  Great   = 'great',    // ±60ms
  Good    = 'good',     // ±100ms
  Miss    = 'miss',
}

export interface NoteEvent {
  beat: number
  subdivision: number
  instrument: DrumInstrument
  midi: number
  absoluteTimeMs?: number   // Calculado por SongParser al cargar
}

export interface SongData {
  id: string
  title: string
  artist: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  bpm: number
  timeSignature: [number, number]
  youtubeUrl: string | null
  youtubeOffsetMs: number
  measures: Measure[]
  sections: Section[]
}

export interface Measure {
  number: number
  notes: NoteEvent[]
}

export interface Section {
  name: string
  startMeasure: number
  endMeasure: number
}

export interface HitResult {
  noteEvent: NoteEvent
  accuracy: HitAccuracy
  deltaMs: number           // + = tarde, - = temprano
  points: number
}

export interface GameState {
  phase: 'idle' | 'playing' | 'paused' | 'results'
  song: SongData | null
  score: number
  combo: number
  multiplier: 1 | 2 | 3 | 4
  accuracy: Record<HitAccuracy, number>
  startedAt: number | null
}
```

---

## 5. Constantes del dominio (`src/constants/game.ts`)

```typescript
export const PERFECT_WINDOW_MS = 30
export const GREAT_WINDOW_MS   = 60
export const GOOD_WINDOW_MS    = 100

export const POINTS_PERFECT = 100
export const POINTS_GREAT   = 75
export const POINTS_GOOD    = 50
export const POINTS_MISS    = 0

export const COMBO_THRESHOLDS = [0, 10, 25, 50] as const
export const MULTIPLIERS      = [1, 2, 3, 4]    as const

export const TIMING_LINE_X_RATIO = 0.2
export const NOTE_SCROLL_SPEED_PX_PER_MS = 0.3
export const TARGET_FPS = 60
```

---

## 6. Orden de Implementación

### Sprint 0 — Scaffolding ✅
- [x] Vite + React + TypeScript + Tailwind
- [x] ESLint + Prettier + Husky + lint-staged
- [x] Vitest + Testing Library
- [x] Path alias `@/`
- [x] Estructura de carpetas
- [x] Git init + primer commit

### Sprint 1 — Tipos y constantes
- [ ] `src/types/index.ts`
- [ ] `src/constants/game.ts`

### Sprint 2 — MIDI
- [ ] `MidiManager.ts` — connect, listen, emit
- [ ] `midiMap.ts` — mapa Roland TD-02KV
- [ ] `useMidi.ts` — hook React
- [ ] `CalibrationScreen.tsx`
- [ ] Smoke test: loguear cada golpe en consola

### Sprint 3 — Engine
- [ ] `SongParser.ts` — JSON → SongData + `absoluteTimeMs`
- [ ] `HitEvaluator.ts` — lógica de ventanas (pura, testeable)
- [ ] Tests de `HitEvaluator` y `SongParser`
- [ ] `GameEngine.ts` — RAF loop + clock + MIDI → evaluador

### Sprint 4 — Renderer
- [ ] `GameCanvas.tsx` — montar canvas, iniciar RAF
- [ ] `NoteRenderer.ts` — scroll de notas, carriles, línea de timing
- [ ] `HUDRenderer.ts` — score, combo overlay
- [ ] `EffectsRenderer.ts` — feedback visual por precisión

### Sprint 5 — Scoring + Stores
- [ ] `ScoreManager.ts` + `ComboSystem.ts`
- [ ] `gameStore.ts` — engine → Zustand → React
- [ ] `progressStore.ts` — persistir en localStorage

### Sprint 6 — UI + Canciones
- [ ] 3 canciones JSON en `public/songs/`
- [ ] `HomeScreen`, `SongSelectScreen`, `GameScreen`, `ResultsScreen`
- [ ] `SettingsScreen` — latency offset, volumen metrónomo
- [ ] `Metronome.ts` con Tone.js

### Sprint 7 — Pulido MVP
- [ ] Verificar 60fps con React DevTools Profiler
- [ ] Medir latencia MIDI → evaluación
- [ ] Cross-browser test (Chrome, Edge)
- [ ] PWA básico (manifest, offline)

---

## 7. Riesgos Técnicos

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|-----------|
| Latencia MIDI variable por OS | Media | Offset configurable + calibración |
| Drift del reloj en sesiones largas | Media | Anclar a `audioContext.currentTime` |
| Canvas no mantiene 60fps en hardware bajo | Baja | Reducir notas visibles, simplificar efectos |
| Web MIDI no disponible (Safari/Firefox) | Alta | Banner de "usa Chrome/Edge" en detección |
| YouTube IFrame API bloqueada por adblocker | Media | Graceful degradation: partitura sin video |

# DrumHero Web — Contexto del Proyecto

## Visión General
Aplicación web estilo "Guitar Hero" para batería electrónica real (Roland TD-02KV vía USB-MIDI).
El usuario conecta la batería, ve una partitura scrollable y golpea los pads en el momento correcto.
Todo corre en el navegador — sin backend en Fase 1-3.

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Framework | React 18 + TypeScript + Vite |
| MIDI | Web MIDI API nativa (sin librerías) |
| Renderizado | Canvas 2D (no SVG — rendimiento) |
| Audio/Metrónomo | Tone.js |
| Video | YouTube IFrame API |
| Estado global | Zustand |
| Estilos | Tailwind CSS |
| Persistencia | localStorage (scores) + IndexedDB (canciones custom) |
| Testing | Vitest + React Testing Library |

**Compatibilidad target:** Chrome y Edge únicamente (Web MIDI API no está en Firefox/Safari).

---

## Estructura de Directorios

```
drumheroweb/
├── public/
│   ├── songs/              # JSON de canciones precargadas
│   └── samples/            # Audio samples (kick, snare, etc.)
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── types/              # Todos los tipos compartidos del dominio
│   │   └── index.ts
│   ├── constants/          # Magic numbers del dominio
│   │   └── game.ts
│   ├── midi/               # Conexión MIDI y calibración
│   │   ├── MidiManager.ts
│   │   ├── midiMap.ts
│   │   └── useMidi.ts
│   ├── engine/             # Reloj, evaluación, estado de juego
│   │   ├── GameEngine.ts
│   │   ├── SongParser.ts
│   │   ├── HitEvaluator.ts
│   │   └── Metronome.ts
│   ├── renderer/           # Canvas principal y efectos
│   │   ├── GameCanvas.tsx
│   │   ├── ScoreRenderer.ts
│   │   ├── NoteRenderer.ts
│   │   ├── HUDRenderer.ts
│   │   └── EffectsRenderer.ts
│   ├── scoring/
│   │   ├── ScoreManager.ts
│   │   └── ComboSystem.ts
│   ├── songs/
│   │   ├── songLoader.ts
│   │   └── songLibrary.ts
│   ├── youtube/
│   │   ├── YouTubePlayer.tsx
│   │   └── SyncManager.ts
│   ├── store/
│   │   ├── gameStore.ts        # Estado de sesión de juego (Zustand)
│   │   ├── settingsStore.ts    # Preferencias (persiste en localStorage)
│   │   └── progressStore.ts    # Scores y progresión (persiste en localStorage)
│   ├── ui/
│   │   ├── screens/            # HomeScreen, SongSelectScreen, GameScreen, ResultsScreen, SettingsScreen, CalibrationScreen
│   │   └── components/         # Componentes reutilizables sin lógica de negocio
│   └── hooks/                  # Hooks de propósito general
│       ├── useMidi.ts
│       ├── useGameEngine.ts
│       └── useLocalStorage.ts
├── tests/
│   ├── engine/             # Tests de lógica pura (HitEvaluator, SongParser, etc.)
│   └── setup.ts
├── CLAUDE.md
├── PLAN.md
└── REQUIREMENTS.md
```

---

## Comandos de Desarrollo

```bash
npm run dev          # Servidor local (localhost — necesario para Web MIDI API)
npm run build        # Build de producción
npm run preview      # Preview del build
npm run test         # Vitest watch
npm run test:run     # Vitest single run
npm run test:coverage
npm run lint         # ESLint (0 warnings permitidos)
npm run lint:fix     # ESLint con autofix
npm run format       # Prettier
npm run typecheck    # tsc --noEmit
```

**IMPORTANTE:** Web MIDI API requiere `localhost` o HTTPS. Nunca `127.0.0.1` directamente.

---

## Convenciones de Código

- **Componentes React:** PascalCase (`GameCanvas.tsx`)
- **Utilidades/clases puras:** PascalCase (`GameEngine.ts`)
- **Hooks:** camelCase con prefijo `use` (`useMidi.ts`)
- **Stores Zustand:** camelCase con sufijo `Store` (`gameStore.ts`)
- **Tipos/interfaces:** PascalCase, sin prefijo `I` (`SongData`, `NoteEvent`)
- **Enums:** PascalCase (`HitAccuracy.Perfect`, `HitAccuracy.Great`)
- **Constantes:** SCREAMING_SNAKE_CASE para magic numbers (`PERFECT_WINDOW_MS = 30`)
- **Imports:** Siempre usar path alias `@/` — nunca paths relativos con más de un nivel

### Orden de imports
1. React y librerías externas
2. `@/types`, `@/constants`
3. Módulos internos `@/engine`, `@/midi`, etc.
4. Imports relativos del mismo directorio (solo si aplica)

---

## Tooling y Calidad de Código

- **ESLint** con `@typescript-eslint` + `eslint-plugin-react-hooks` — `npm run lint` debe pasar con 0 warnings
- **Prettier** para formatting — no mezclar con reglas de ESLint
- **Husky pre-commit** → lint-staged (ESLint + Prettier solo en archivos staged)
- **NO hacer `--no-verify`** para saltarse hooks. Si falla, arreglar el problema.
- **Vitest** con jsdom — solo testear lógica pura (HitEvaluator, SongParser, ComboSystem)
- **NO testear** canvas ni Web MIDI API (requieren browser real)

---

## Reglas Críticas del Dominio

### MIDI
- Las notas de la Roland TD-02KV vienen en **canal 10** (index 9 en Web MIDI, status byte `0x99`)
- `noteOn` con velocity 0 = `noteOff` en Roland — tratar igual que noteOff
- El mapeo de notas puede variar por unidad — siempre usar la pantalla de calibración
- Latencia offset configurable en ms en Settings

### Timing y Rendimiento
- **NUNCA usar `setInterval`** para el reloj del juego — usar `performance.now()` dentro de `requestAnimationFrame`
- El canvas debe mantener **60fps** — todo cálculo pesado fuera del RAF loop
- Pipeline MIDI input → evaluación debe ser **<10ms**
- El evaluador de hits compara `performance.now()` timestamp del golpe vs posición esperada de la nota

### Ventanas de Precisión
```
Perfect: ±30ms  → 100 puntos
Great:   ±60ms  → 75 puntos
Good:    ±100ms → 50 puntos
Miss:    >100ms → 0 puntos
```

### Multiplicadores de Combo
```
x1: 0-9 hits consecutivos
x2: 10-24
x3: 25-49
x4: 50+
```

---

## Formato de Canción (JSON)

```json
{
  "id": "basic-rock-001",
  "title": "Basic Rock Beat",
  "bpm": 80,
  "timeSignature": [4, 4],
  "youtubeUrl": null,
  "measures": [
    {
      "number": 1,
      "notes": [
        { "beat": 1, "subdivision": 0, "instrument": "kick", "midi": 36 }
      ]
    }
  ]
}
```

`subdivision`: 0 = en el beat, 0.5 = corchea entre beats, 0.25/0.75 = semicorcheas.

---

## Mapa MIDI Roland TD-02KV

| Instrumento | Nota MIDI |
|-------------|-----------|
| Kick | 36 |
| Snare (head) | 38 |
| Snare (rim) | 40 |
| Hi-Hat Closed | 42 |
| Hi-Hat Open | 46 |
| Hi-Hat Pedal | 44 |
| Tom 1 | 48 |
| Tom 2 | 45 |
| Crash | 49 |
| Ride (bow) | 51 |
| Ride (edge) | 59 |

---

## Estado Actual del Proyecto

**Fase:** Scaffolding completado — listo para Sprint 1.
**Próximo paso:** Implementar `src/types/index.ts` y `src/constants/game.ts`.

### Fases de Desarrollo
- [x] **Sprint 0:** Scaffolding (Vite + TS + Tailwind + ESLint + Husky + Vitest)
- [ ] **Sprint 1:** Tipos del dominio y constantes
- [ ] **Sprint 2:** Módulo MIDI + calibración
- [ ] **Sprint 3:** GameEngine + SongParser + HitEvaluator
- [ ] **Sprint 4:** Renderer (Canvas + notas + HUD + efectos)
- [ ] **Sprint 5:** Scoring + Stores + persistencia
- [ ] **Sprint 6:** UI Screens + canciones JSON
- [ ] **Sprint 7:** Pulido MVP (60fps, latencia, PWA)

---

## Restricciones y Decisiones Arquitecturales

- **Sin backend** hasta Fase 4 — todo en el browser
- **Canvas 2D** sobre SVG — el scroll de notas a 60fps es crítico
- **Zustand** sobre Redux — estado de juego en tiempo real no necesita Redux DevTools
- **Web MIDI API nativa** — no usar librerías wrapper que añadan latencia
- **No usar `setInterval`** ni `setTimeout` para timing del juego
- **React NO se re-renderiza en cada frame** — el canvas es imperativo, Zustand notifica a React solo en cambios de pantalla
- Testear siempre con hardware real — emuladores MIDI no replican latencia real

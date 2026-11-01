# DrumHero AI (V2) — Contexto del Proyecto

## Visión General
Aplicación web estilo Guitar Hero / Melodics para batería electrónica real (Roland TD-02KV vía USB-MIDI).
El usuario sube un MP3 (y opcionalmente enlaza un video de YouTube), un worker de IA genera la partitura de batería
y el usuario la toca mientras la partitura se desplaza sincronizada con la música. Cada golpe se califica Perfecto / Cerca / Fallo.

**Documentos fuente de verdad:**
- `REQUIREMENTS_V2.md` — producto, requisitos, riesgos.
- `PLAN_V2.md` — arquitectura, chart v2, API del worker, mapa diseño → componentes, tareas por fase con criterios de aceptación.
- `design/` — maquetas (`Main.dc.html`, `Import.dc.html`, `Results.dc.html`) y `DrumHero AI — Boceto.pdf`. Se reimplementan con React + Tailwind; nunca se copia su marcado.
- `REQUIREMENTS.md` / `PLAN.md` — MVP V1, solo como histórico.

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Framework | React 19 + TypeScript (strict) + Vite |
| MIDI | Web MIDI API nativa (sin librerías) |
| Audio / reloj maestro | Web Audio API (`AudioContext`, stems como `AudioBufferSourceNode`) |
| Renderizado partitura | Canvas 2D |
| Video | YouTube IFrame API (siempre silenciado) |
| Estado global | Zustand |
| Estilos | Tailwind CSS v4, tokens en `@theme` (`src/styles/theme.css`) |
| Persistencia | localStorage (settings) + IndexedDB (audio, stems, charts) + Supabase; service worker generado en el build (`pwa/`) para el shell offline |
| Worker IA | Python 3.10 + FastAPI + Demucs + ADTOF + beat_this, en Docker (`worker/`) |
| Testing | Vitest + RTL (frontend), pytest (worker) |

**Navegadores:** Chrome y Edge de escritorio (Web MIDI).

---

## Comandos

```bash
npm run dev          # localhost:5173 (Web MIDI exige localhost o HTTPS, nunca 127.0.0.1)
npm run build
npm run typecheck    # tsc -b (revisa app + config)
npm run lint         # ESLint, 0 warnings
npm run test:run     # Vitest single run
npm run format       # Prettier
npm run deploy       # Publica el build estático en Vercel (https://drumhero-beta.vercel.app); exige .env.local
```

Worker (a partir de la Fase A): ver `worker/README.md`.

---

## Reglas de oro

1. **Un solo reloj:** la posición de reproducción del MP3 (`SongClock` sobre `AudioContext`). Partitura, metrónomo, video y evaluación de golpes leen ese reloj; nada avanza por su cuenta.
2. **Golpes MIDI** se evalúan con su propio `MIDIMessageEvent.timeStamp` convertido con `clock.perfToSong()`, no con el tiempo del frame.
3. **YouTube** solo como video silenciado y sincronizado (offset + corrección si la deriva > 40 ms). Nunca extraer ni procesar su audio.
4. La IA solo procesa audio subido por el usuario. Los archivos del usuario son privados (`worker/poc/songs/` está en `.gitignore`).
5. **Nunca `setInterval`/`setTimeout` como reloj del juego.** RAF + `performance.now()` solo para pintar y para agendar con lookahead.
6. **React no se re-renderiza por frame.** Canvas imperativo; el HUD se actualiza por golpe con selectores de Zustand.
7. **Modo oscuro por defecto**, como las maquetas. La partitura se pinta sobre papel claro (`#F4F2EC`).
8. Si `REQUIREMENTS_V2.md` y el diseño se contradicen, preguntar antes de decidir.

---

## Dominio

### Ventanas de acierto por nivel (REQUIREMENTS_V2 §6.5)

| Nivel | Perfecto | Cerca | Puntos (Perfecto / Cerca) |
|-------|----------|-------|---------------------------|
| Principiante | ±45 ms | ±110 ms | 100 / 50 |
| Intermedio | ±30 ms | ±80 ms | 100 / 50 |
| Experto | ±20 ms | ±50 ms | 100 / 40 |

- Fuera de *Cerca* = Fallo (0 puntos, rompe el combo).
- Pad incorrecto = feedback gris solamente (no rompe combo ni cuenta en precisión).
- Puntos por dinámica (opcional): +10 si ghost < 50 de velocity o acento > 100.
- Combo: x1 (0–9), x2 (10–24), x3 (25–49), x4 (50+).
- Precisión = (Perfecto + Cerca) / notas evaluadas.
- **Nivel** (ventanas) y **dificultad** (Básico / Intermedio / Completo = qué notas hay) son ejes independientes.

### MIDI Roland TD-02KV (canal 10, status `0x99`; noteOn con velocity 0 = noteOff)

| Pieza | Nota | | Pieza | Nota |
|-------|------|-|-------|------|
| kick | 36 | | tom1 | 48 |
| snare | 38 | | tom2 | 45 |
| snare_rim | 40 | | tom3 | 43 |
| hihat_closed | 42 | | crash | 49 |
| hihat_open | 46 | | ride | 51 (y 59 borde → ride) |
| hihat_pedal | 44 | | | |

El mapeo varía por unidad: siempre usar la pantalla de calibración. Latencia del kit calibrada y restada en `HitEvaluator`.

### Chart v2
Definido en `PLAN_V2.md` §2 y `shared/chart-v2.schema.json`. `t` en segundos desde el inicio del MP3 (fuente de verdad);
compás y beat se derivan de `grid.beats` / `grid.downbeats`. `confidence < 0.6` = nota "por revisar".

---

## Convenciones de Código

- Componentes React y clases: PascalCase (`GameCanvas.tsx`, `GameEngine.ts`). Hooks: `useXxx`. Stores: `xxxStore.ts`.
- Tipos sin prefijo `I`. Constantes de dominio en SCREAMING_SNAKE_CASE.
- Imports con alias `@/`; nunca paths relativos de más de un nivel. Orden: externos → `@/types`, `@/constants` → módulos internos → relativos.
- Colores y tipografía solo desde tokens (`theme.css` en DOM, `constants/theme.ts` en canvas). Nada de hex sueltos en componentes.
- Comentarios en español, como el código existente.

## Calidad y flujo de trabajo

- `npm run typecheck`, `npm run lint` y `npm run test:run` deben pasar antes de cada commit.
- Husky pre-commit → lint-staged. **Nunca `--no-verify`.**
- Conventional commits. Una feature por vez: describir → implementar → tests → checks → commit → esperar confirmación.
- Testear lógica pura (evaluador, motor con `FakeClock`, scoring, layouts, parsers). No testear canvas ni Web MIDI real; eso se valida con pruebas manuales guiadas con el hardware.

---

## Estado Actual

**Fase:** D implementada (D1–D8); D1–D7 publicadas, D8 sin publicar. **Próximo:** verificar D8 con el kit (checklist de REQUIREMENTS_V2 §10) y publicarla; cerrar A6 (`worker/poc/REPORT.md`; faltan referencias y una 5.ª canción).

- [x] Fase 0 — preparación (design/, strict typecheck, husky, CLAUDE.md V2)
- [ ] Fase A — prueba de concepto de IA: A1–A5 hechas; falta A6 (`worker/poc/REPORT.md`)
- [x] Fase B — juego con chart propio: B1–B15 hechas (B12 en Supabase `drumhero`, publicado en https://drumhero-beta.vercel.app con `npm run deploy`)
- [x] Fase C — YouTube y editor: C1–C5 hechas (video sincronizado, asistente de offset, editor con guardado en Supabase, escuchar la transcripción, grabar con el kit)
- [ ] Fase D — aprendizaje: D1–D8 hechas (dificultades, tempo 50–100 % con WSOLA propio, loop A–B con cuenta y rampa, modo espera, capas, compases flojos, historial/racha/meta/insignias en Supabase, latencia por dispositivo, PWA y panel de rendimiento); falta la verificación manual con el kit

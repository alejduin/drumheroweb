# DrumHero Web App — Documento de Requerimientos

## 1. Visión General

Aplicación web estilo "Guitar Hero" para batería electrónica real. El usuario conecta una batería Roland TD-02KV vía Web MIDI API, ve una partitura que se desplaza hacia una línea de timing, e intenta golpear los pads correctos en el momento preciso. Se acumulan puntos por precisión.

---

## 2. Hardware Target

- **Batería:** Roland TD-02KV
- **Conexión:** USB-MIDI (la TD-02KV expone un puerto MIDI estándar por USB)
- **Pads disponibles (notas MIDI estándar Roland):**

| Pad | Nota MIDI | Canal |
|-----|-----------|-------|
| Kick | 36 | 10 |
| Snare (head) | 38 | 10 |
| Snare (rim) | 40 | 10 |
| Hi-Hat Closed | 42 | 10 |
| Hi-Hat Open | 46 | 10 |
| Hi-Hat Pedal (foot close) | 44 | 10 |
| Tom 1 | 48 | 10 |
| Tom 2 | 45 | 10 |
| Crash | 49 | 10 |
| Ride (bow) | 51 | 10 |
| Ride (edge) | 59 | 10 |

> **Nota:** Verificar el mapeo exacto con la TD-02KV ya que puede variar ligeramente. Incluir una pantalla de calibración MIDI donde el usuario golpea cada pad y el sistema detecta las notas.

---

## 3. Stack Tecnológico Recomendado

- **Framework:** React + TypeScript + Vite
- **Audio/MIDI:** Web MIDI API nativa (no se necesita librería externa)
- **Renderizado de partitura:** Canvas 2D o SVG (Canvas preferido por rendimiento de scroll)
- **Audio engine:** Tone.js (para metrónomo, sonidos de referencia y sincronización precisa)
- **Video:** YouTube IFrame API (para integración con videos)
- **State management:** Zustand (ligero, perfecto para estado de juego en tiempo real)
- **Estilos:** Tailwind CSS
- **Formato de canciones:** JSON propio (ver sección 8)
- **Persistencia:** localStorage para scores, IndexedDB para canciones custom

---

## 4. Módulos Principales

### 4.1 Conexión MIDI (`/src/midi/`)
- Detectar dispositivos MIDI al iniciar
- Listar puertos de entrada disponibles
- Permitir selección manual del puerto (por si hay múltiples dispositivos)
- Escuchar mensajes `noteOn` (status 0x99 para canal 10) con velocidad
- **Pantalla de calibración:** el usuario golpea cada pad y el sistema mapea nota MIDI → instrumento visual
- Calcular y compensar latencia MIDI (offset configurable en ms)

### 4.2 Motor de Partitura (`/src/engine/`)
- Parsear canción desde formato JSON
- Mantener un reloj de alta precisión (`performance.now()`)
- Calcular posición actual en la canción
- Evaluar hits: comparar timestamp del golpe MIDI vs timestamp de la nota esperada
- **Ventanas de precisión:**
  - **Perfect:** ±30ms → 100 puntos
  - **Great:** ±60ms → 75 puntos
  - **Good:** ±100ms → 50 puntos
  - **Miss:** >100ms o no golpe → 0 puntos
- Manejar velocidad variable (BPM changes dentro de una canción)

### 4.3 Renderizado Visual (`/src/renderer/`)
- Canvas principal con la partitura desplazándose de derecha a izquierda
- **Línea de timing** (púrpura/destacada) fija en posición ~20% desde la izquierda
- Notas representadas como íconos/símbolos en carriles (un carril por instrumento):
  - Carril superior: Crash, Ride
  - Carril medio-alto: Hi-Hat (cerrado/abierto diferenciados)
  - Carril medio: Snare
  - Carril medio-bajo: Toms (1, 2)
  - Carril inferior: Kick
- Código de colores por instrumento (consistente con colores estándar de juegos de batería)
- Efecto visual al golpear: explosión/destello en el carril correspondiente
- Feedback de color según precisión (dorado=Perfect, verde=Great, amarillo=Good, rojo=Miss)
- Las notas ya pasadas se desvanecen o desaparecen
- Indicador de compás y beats actual

### 4.4 Sistema de Puntuación (`/src/scoring/`)
- Score acumulado visible en todo momento
- Combo counter (hits consecutivos sin miss)
- Multiplicador de combo: x1 (0-9), x2 (10-24), x3 (25-49), x4 (50+)
- Barra de "energía" o "streak" visual
- Al finalizar la canción mostrar:
  - Score total
  - Porcentaje de notas acertadas
  - Distribución (Perfect/Great/Good/Miss)
  - Mejor racha (longest combo)
  - Estrellas (1-5) basadas en porcentaje
- Guardar mejores scores por canción en localStorage

### 4.5 Integración YouTube (`/src/youtube/`)
- Input para pegar URL de YouTube
- Reproductor embebido sincronizado con la partitura
- Controles: play/pause unificados (un botón controla ambos)
- Opción de ajustar offset de sincronización video↔partitura (±ms)
- El video se muestra en una sección reducida (picture-in-picture o lateral)
- Opción de silenciar la pista de audio del video y solo escuchar la batería real

### 4.6 Selección de Canciones (`/src/songs/`)
- Biblioteca de canciones precargadas (empezar con 3-5 patrones básicos):
  - Basic Rock Beat (4/4, 80 BPM)
  - Simple Funk (4/4, 100 BPM)
  - Bossa Nova (4/4, 120 BPM)
  - Basic Fill Pattern
  - Paradiddle Exercise
- Filtro por dificultad (Principiante / Intermedio / Avanzado)
- Preview del patrón antes de jugar
- Indicador de mejor score obtenido

---

## 5. Funcionalidades Adicionales para Mejorar Jugabilidad

### 5.1 Modo Práctica
- Reducir velocidad de la canción (50%, 75%, 100%)
- Loop de secciones específicas (seleccionar compases para repetir)
- Modo "esperar mi golpe" — la partitura se pausa hasta que el usuario golpee la nota correcta
- Mostrar/ocultar nombres de los pads sobre las notas

### 5.2 Metrónomo Integrado
- Click audible sincronizado con el BPM
- Visual: flash en cada beat
- Opción de solo click en downbeat (beat 1) o en todos los beats
- Sonido configurable (hi-hat, click, woodblock)

### 5.3 Modo Freestyle / Sandbox
- Sin partitura, solo el renderizado visual de qué pads estás golpeando
- Visualización tipo "wave" o "rain" de los golpes en tiempo real
- Grabación de sesión: el usuario toca libremente y al terminar puede ver/exportar lo que tocó como partitura

### 5.4 Sistema de Progresión
- Lecciones ordenadas por dificultad creciente
- Desbloqueo de lecciones al alcanzar cierto score en la anterior
- Badges/logros: "Primera canción perfecta", "Combo de 100", "10 canciones completadas"
- Estadísticas de progreso: gráfica de mejora en el tiempo

### 5.5 Editor de Canciones (Fase 2)
- Grid editor para crear patrones propios
- Importar archivos MIDI estándar (.mid) y convertirlos al formato interno
- Exportar canciones como JSON para compartir
- Comunidad: subir/descargar patrones creados por otros (requiere backend, fase posterior)

### 5.6 Feedback de Audio
- Sonidos de referencia opcionales (samples de batería del app) que suenan al golpear
- Útil para practicar sin amplificador
- Volumen independiente del audio de YouTube

### 5.7 Ajustes de Accesibilidad
- Tamaño de notas configurable
- Velocidad de scroll ajustable
- Modo alto contraste
- Indicadores de golpe tanto visuales como de audio

---

## 6. Pantallas / Vistas

1. **Home / Menú Principal**
   - Logo, nombre del app
   - Estado de conexión MIDI (indicador verde/rojo)
   - Botones: Jugar, Práctica, Freestyle, Lecciones, Ajustes

2. **Selección de Canción**
   - Lista/grid de canciones con miniatura, BPM, dificultad, mejor score
   - Búsqueda y filtros
   - Botón para cargar canción con video de YouTube

3. **Pantalla de Juego**
   - Partitura scrollable (zona principal)
   - Línea de timing
   - HUD: score, combo, multiplicador, progreso de canción
   - Video YouTube (si aplica, en esquina)
   - Botón pausa

4. **Resultados**
   - Resumen de score, estrellas, estadísticas
   - Comparativa con mejor score anterior
   - Botones: Reintentar, Volver al menú

5. **Ajustes**
   - Conexión MIDI (selección de puerto, calibración)
   - Audio (volumen metrónomo, samples, video)
   - Visual (velocidad scroll, tamaño notas, tema claro/oscuro)
   - Offset de latencia MIDI
   - Offset sincronización video

6. **Calibración MIDI**
   - Instrucciones paso a paso
   - "Golpea el snare" → detecta nota → mapea
   - Repetir para cada pad

---

## 7. Formato de Canción (JSON)

```json
{
  "id": "basic-rock-001",
  "title": "Basic Rock Beat",
  "artist": "Lesson Pack",
  "difficulty": "beginner",
  "bpm": 80,
  "timeSignature": [4, 4],
  "youtubeUrl": null,
  "youtubeOffsetMs": 0,
  "measures": [
    {
      "number": 1,
      "notes": [
        { "beat": 1, "subdivision": 0, "instrument": "kick", "midi": 36 },
        { "beat": 1, "subdivision": 0, "instrument": "hihat_closed", "midi": 42 },
        { "beat": 2, "subdivision": 0, "instrument": "hihat_closed", "midi": 42 },
        { "beat": 2, "subdivision": 0, "instrument": "snare", "midi": 38 },
        { "beat": 3, "subdivision": 0, "instrument": "kick", "midi": 36 },
        { "beat": 3, "subdivision": 0, "instrument": "hihat_closed", "midi": 42 },
        { "beat": 4, "subdivision": 0, "instrument": "hihat_closed", "midi": 42 },
        { "beat": 4, "subdivision": 0, "instrument": "snare", "midi": 38 }
      ]
    }
  ],
  "sections": [
    { "name": "Intro", "startMeasure": 1, "endMeasure": 4 },
    { "name": "Verse", "startMeasure": 5, "endMeasure": 12 }
  ]
}
```

> El campo `subdivision` permite notas entre beats: 0 = en el beat, 0.5 = octavo entre beats (and), 0.25/0.75 = semicorcheas.

---

## 8. Requisitos No Funcionales

- **Latencia:** El pipeline MIDI input → evaluación debe ser <10ms
- **Frame rate:** El renderizado del canvas debe mantener 60fps
- **Compatibilidad:** Chrome y Edge (Web MIDI API no está en Firefox/Safari)
- **Responsive:** Funcional en pantalla completa de desktop (1920x1080 mínimo target)
- **Offline:** Una vez cargada, la app debe funcionar sin conexión (excepto YouTube)
- **Sin backend inicial:** Todo corre en el navegador. Backend solo si se implementa comunidad

---

## 9. Fases de Desarrollo

### Fase 1 — MVP (semanas 1-3)
- [ ] Setup proyecto (React + TS + Vite + Tailwind)
- [ ] Conexión Web MIDI API con la TD-02KV
- [ ] Pantalla de calibración MIDI
- [ ] Motor de partitura básico (parsear JSON, reloj de precisión)
- [ ] Renderizado canvas con scroll de notas y línea de timing
- [ ] Sistema de evaluación de hits (ventanas de precisión)
- [ ] Scoring básico (puntos + combo)
- [ ] 3 canciones de ejemplo precargadas
- [ ] Pantalla de resultados
- [ ] Metrónomo integrado

### Fase 2 — Mejoras de Jugabilidad (semanas 4-5)
- [ ] Integración YouTube (reproductor + sincronización)
- [ ] Modo práctica (velocidad reducida, loop, modo esperar)
- [ ] Efectos visuales de feedback (explosiones, colores por precisión)
- [ ] Más canciones de ejemplo (10+)
- [ ] Persistencia de scores en localStorage
- [ ] Ajustes de configuración completos

### Fase 3 — Engagement (semanas 6-8)
- [ ] Sistema de progresión y lecciones
- [ ] Modo freestyle con grabación
- [ ] Editor de canciones (grid)
- [ ] Importación de archivos MIDI (.mid)
- [ ] Badges y logros
- [ ] Estadísticas de progreso con gráficas
- [ ] Feedback de audio (samples propios)
- [ ] Tema oscuro/claro

### Fase 4 — Comunidad (futuro)
- [ ] Backend (API + DB)
- [ ] Cuentas de usuario
- [ ] Subir/compartir canciones
- [ ] Leaderboards por canción
- [ ] Importación automática de tabs de batería desde URLs

---

## 10. Estructura de Proyecto Sugerida

```
drumhero/
├── public/
│   └── songs/              # JSON de canciones precargadas
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── midi/
│   │   ├── MidiManager.ts       # Conexión y escucha MIDI
│   │   ├── MidiCalibration.tsx   # UI de calibración
│   │   └── midiMap.ts           # Mapeo nota→instrumento
│   ├── engine/
│   │   ├── GameEngine.ts        # Reloj, evaluación, estado del juego
│   │   ├── SongParser.ts        # Parseo de formato JSON
│   │   └── HitEvaluator.ts      # Lógica de ventanas de precisión
│   ├── renderer/
│   │   ├── GameCanvas.tsx       # Canvas principal
│   │   ├── NoteRenderer.ts      # Dibujar notas
│   │   ├── HUDRenderer.ts       # Score, combo, progreso
│   │   └── EffectsRenderer.ts   # Explosiones, feedback visual
│   ├── scoring/
│   │   ├── ScoreManager.ts
│   │   └── ComboSystem.ts
│   ├── youtube/
│   │   ├── YouTubePlayer.tsx
│   │   └── SyncManager.ts
│   ├── songs/
│   │   ├── SongLibrary.tsx
│   │   └── songData/
│   ├── practice/
│   │   ├── PracticeMode.ts
│   │   └── Metronome.ts
│   ├── ui/
│   │   ├── screens/             # Home, SongSelect, Game, Results, Settings
│   │   └── components/          # Botones, barras, indicadores reutilizables
│   ├── store/
│   │   └── gameStore.ts         # Zustand store
│   └── types/
│       └── index.ts             # Tipos compartidos
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

---

## 11. Notas para Claude Code

- Priorizar la **Fase 1** y entregar un MVP funcional antes de avanzar.
- La Web MIDI API requiere HTTPS o localhost para funcionar.
- Usar `requestAnimationFrame` para el loop de renderizado del canvas.
- Para el reloj de precisión, NO usar `setInterval`. Usar `performance.now()` dentro del RAF loop.
- Las notas MIDI de la Roland vienen en canal 10 (channel index 9 en Web MIDI API, status byte 0x99).
- El `noteOn` con velocity 0 equivale a `noteOff` en algunos dispositivos.
- Testear siempre con el dispositivo real; los emuladores MIDI no replican la latencia real.

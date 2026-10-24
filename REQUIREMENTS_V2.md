# DrumHero AI — Requerimientos V2

> Evolución de DrumHero. El usuario sube un MP3 (y opcionalmente enlaza un video de YouTube), una IA genera la partitura de batería y el usuario la toca con su Roland TD-02KV mientras la partitura se desplaza sincronizada con la música. Cada golpe se califica con color y puntos.
>
> **Base existente (reutilizar):** conexión Web MIDI, GameEngine, HitEvaluator, renderer canvas, stores Zustand, scoring, metrónomo, pantallas Home/Settings/Results.
> **Stack actual:** React + TypeScript + Vite + Tailwind + Tone.js + Zustand.

---

## 1. Visión y alcance

**Qué es:** una web app tipo Guitar Hero / Melodics para batería electrónica real, que funciona con canciones del propio usuario.

**Flujo principal:**
1. El usuario sube un MP3 (opcional: enlace de YouTube de la misma canción).
2. Un worker de IA aísla la batería, detecta golpes por pieza, estima tempo y cuantiza.
3. Se genera un *chart* JSON con 3 dificultades.
4. El usuario revisa/corrige la transcripción en un editor.
5. Juega: la partitura se desplaza hacia la línea de golpe sincronizada con el audio (y el video).
6. Cada golpe se califica Perfecto / Cerca / Fallo, con color y puntos.
7. Resultados y práctica guiada de los compases más débiles.

**Diferenciadores frente a la competencia:**
1. Dificultades automáticas desde la misma canción (Básico → Completo).
2. Práctica inteligente: detecta los compases más débiles y arma un loop con tempo progresivo.
3. Notación real de batería (con vista alternativa de carriles estilo Guitar Hero).
4. Indicador temprano/tarde y dinámica (ghost notes y acentos) usando la velocidad MIDI.
5. Sin fricción ni cobros opacos (principales quejas de Melodics).

---

## 2. Hardware objetivo

- **Kit:** Roland TD-02KV por USB-MIDI (canal 10, velocidad incluida).
- Mapeo de notas MIDI y calibración: ya implementados en el MVP (`midiMap.ts`, `MidiManager.ts`). Mantener.
- Mapear a las piezas reales: hi-hat abierto/cerrado/pedal son piezas distintas, no pads arbitrarios.

---

## 3. Panorama competitivo (resumen)

| Plataforma | Fortalezas | Debilidades / críticas |
| --- | --- | --- |
| Playdrumsonline | MP3/YouTube → partitura IA, separa stem de batería, mezcla batería vs. backing, editor, loop, tempo lento, juego con kit electrónico | Competidor directo; foco en transcripción/comunidad, no en camino de aprendizaje |
| Melodics | Feedback visual temprano/tarde, lecciones guiadas, versiones por nivel, rachas, socio de Roland | Suscripción cara sin compra única, ventanas permisivas, bugs, menús que reinician al Grado 1, puntuación confusa, catálogo cerrado, latencia |
| Clone Hero | Gratis, canciones propias, acepta kits MIDI, ghost notes/acentos, visualiza ventana de acierto | Carriles de colores (no notación real); charts hechos a mano |
| Rock Band / Guitar Hero | Gran sensación de juego | Hi-hat abierto/cerrado en pads distintos crea malos hábitos |
| Klangio Drum2Notes / DrumConvert | Transcripción a PDF/MIDI/MusicXML; Klangio ofrece API REST | Solo transcriben; sin juego ni feedback |

Fuentes: [Playdrumsonline](https://www.playdrumsonline.com/article/automatically-transcribe-drum-sheets) · [Melodics](https://melodics.com/info/ai-info-page) · [reseñas Melodics](https://marlvel.ai/apps/melodics-drum-lessons-app/reviews) · [Clone Hero wiki](https://wiki.clonehero.net/books/guitars-drums-controllers/page/video-game-drums/revisions/825) · [Engadget sobre drums de Rock Band](https://www.engadget.com/2008-07-22-joystiq-e3-sticks-on-ion-premium-drum-set.html) · [Klangio](https://music-china.german-pavilion.com/en/sites/exhibitors/143380)

---

## 4. Factibilidad técnica

| Componente | Factibilidad | Detalle |
| --- | --- | --- |
| Aislar la batería de un MP3 | Alta | Demucs v4 separa el stem de batería; paso estándar previo a la transcripción |
| Detectar golpes por pieza | Media-alta | ADTOF transcribe 5 clases (bombo, caja, hi-hat, toms, platillos); con un modelo de separación por pieza distingue crash y ride |
| Precisión en mezclas reales | Media | Los modelos aún fallan en toms y platillos; la mayor fuente de error son instrumentos melódicos y voz. Mitigación: editor + marcar notas de baja confianza |
| Alternativa comercial | Alta | API REST de Klangio (transcripción, separación, beat tracking); costo por uso |
| Cuantización a rejilla | Alta | Beat tracking para BPM y compases, luego cuantizar cada golpe |
| Audio de YouTube como entrada de IA | **No recomendado** | Los términos de la API de YouTube prohíben separar/aislar su audio. La IA solo procesa MP3 subido por el usuario |
| Reproducir YouTube sincronizado | Alta | IFrame Player API (play, pausa, seek, tiempo). El tiempo es poco granular: interpolar con `performance.now()` |
| Alinear MP3 con video | Media | No se puede leer el audio del iframe: asistente de sincronía manual (offset en ms) |
| MIDI desde TD-02KV | Alta | Ya resuelto en el MVP |
| Latencia y calibración | Alta | Asistente guiado: latencia MIDI + audio + video |

Fuentes: [arXiv 2509.24853](https://arxiv.org/html/2509.24853v1) · [ISMIR 2025](https://ismir2025program.ismir.net/poster_130.html) · [9to5Google sobre términos de YouTube](https://9to5google.com/?p=36053)

**Decisión:** la IA siempre trabaja sobre un MP3 subido por el usuario. YouTube es opcional y solo aporta el video, silenciado y sincronizado mediante un offset. El MP3 es el único reloj maestro.

---

## 5. Arquitectura propuesta

```
ANÁLISIS (una vez por canción · worker Python en Docker)
  Subir MP3 (Supabase Storage)
    → Demucs (aísla la batería)
    → ADTOF (golpes por pieza)
    → Tempo y rejilla (BPM + cuantización)
    → Chart JSON (3 dificultades) + stems, cacheados

JUEGO (navegador · React + Web MIDI)
  Audio MP3 (reloj maestro) ──tiempo──▶ Motor de juego ◀──golpes── Roland TD-02KV
        │                                    │
        └─ sigue el reloj ▶ Video YouTube    └──▶ Partitura canvas (pentagrama + colores)
              (silenciado, opcional)
```

**Stack sugerido:**
- Frontend: el actual (React + TS + Vite + Tailwind + Zustand + Tone.js).
- Worker de IA: Python + FastAPI + Demucs + ADTOF, en Docker (GPU bajo demanda). Intercambiable por la API de Klangio sin tocar el resto.
- Backend: Supabase (auth opcional, Storage, Postgres para charts y puntajes).
- Cola de trabajos asíncrona; caché por hash del archivo para no analizar dos veces la misma canción.

**Regla de oro de sincronía:** `audio.currentTime` es el único reloj. Partitura, video y evaluación de golpes leen ese reloj; nunca se avanzan por separado.

---

## 6. Requerimientos funcionales

### 6.1 Importar canción (MVP)
- Subir MP3, WAV o M4A (máximo 10 minutos).
- Campo opcional para el enlace de YouTube de la misma canción.
- Metadatos: título, artista, BPM detectado (editable), compás.
- Biblioteca personal con estados: *Analizando*, *Lista*, *Requiere revisión*.

### 6.2 Análisis con IA (MVP)
- Proceso asíncrono con progreso por etapa: separar batería → detectar golpes → detectar tempo → cuantizar → generar dificultades.
- Salida: chart JSON con cada nota (tiempo en segundos, pieza, velocidad, confianza 0–1).
- Guardar stem de batería y backing sin batería para el mezclador.
- Notificar al terminar (puede tardar minutos).

### 6.3 Editor y verificación de partitura (MVP)
- Ver la partitura completa; notas de baja confianza resaltadas.
- Agregar, borrar, mover y cambiar la pieza de cada nota; recuantizar una sección.
- Modo "escuchar la transcripción": la app toca la partitura con samples sobre el audio original.
- Modo "grabar con mi kit": tocar un pasaje y reemplazar esa sección del chart.

### 6.4 Sincronía audio + video (MVP)
- Reloj maestro único: `currentTime` del MP3.
- Video de YouTube silenciado; corrección de deriva si el desfase supera 40 ms.
- Asistente de sincronía: el usuario pulsa un pad en el primer golpe de bombo del video; la app calcula el offset. Ajuste fino ±5 ms.
- Calibración de latencia del kit: tocar con click 8 veces y promediar el desfase.

### 6.5 Pantalla de juego (MVP)
- Pentagrama de batería que se desplaza de derecha a izquierda; línea de golpe fija (color morado) con marcadores ▼ y ▲.
- Vista alternativa "carriles" de colores para quien no lee notación.
- Feedback por golpe: verde = Perfecto, ámbar = Cerca (con etiqueta Temprano/Tarde), rojo = Fallo, gris = pad incorrecto. Resplandor en la línea de golpe.
- HUD: puntos, combo, multiplicador, precisión en vivo, medidor de timing temprano/tarde.
- Mezclador: volumen de batería original, backing, metrónomo y samples del kit.
- Layout (según boceto): partitura arriba; video de YouTube y barra del MP3 debajo; panel de configuración a la derecha.

**Ventanas de acierto por nivel (valores iniciales, ajustar en pruebas):**

| Nivel | Perfecto | Cerca | Puntos |
| --- | --- | --- | --- |
| Principiante | ±45 ms | ±110 ms | 100 / 50 |
| Intermedio | ±30 ms | ±80 ms | 100 / 50 |
| Experto | ±20 ms | ±50 ms | 100 / 40 |

Fuera de la ventana *Cerca* el golpe es Fallo (0 puntos, rompe el combo). Multiplicador de combo: x1 (0–9), x2 (10–24), x3 (25–49), x4 (50+).

### 6.6 Práctica guiada
- Tempo variable 50–100% sin cambiar el tono (time-stretch).
- Loop A–B por compases; rampa de tempo (+5% al lograr 90% de precisión).
- Modo espera: la partitura se detiene hasta tocar la nota correcta.
- Práctica por capas: bombo y caja → agregar hi-hat → kit completo.
- Cuenta regresiva de un compás al empezar o reanudar.

### 6.7 Progreso y motivación
- Resultados: estrellas, precisión, distribución Perfecto/Cerca/Fallo, temprano vs. tarde, precisión por pieza, mapa de calor por compás.
- Botón "Practicar mis 4 compases más débiles".
- Historial por canción, racha diaria, meta semanal en minutos.
- Insignias por hitos de aprendizaje (primer 100% en un groove, 7 días seguidos), no solo por puntos.

---

## 7. Dificultades automáticas

- **Básico:** solo bombo y caja en tiempos fuertes; hi-hat en negras.
- **Intermedio:** hi-hat en corcheas, fills simplificados a caja, sin ghost notes.
- **Completo:** la transcripción entera.

---

## 8. Recomendaciones UI/UX

| Lo que dicen los usuarios | Recomendación |
| --- | --- |
| Melodics: el feedback temprano/tarde es lo que más mejora el timing | Etiqueta "‹ Temprano / Tarde ›" en cada golpe Cerca; medidor horizontal con la tendencia de los últimos 16 golpes |
| Melodics: demasiado margen para apresurarse o arrastrar | Ventanas estrictas configurables y visibles; opción de mostrar el milisegundo exacto |
| Melodics: el menú vuelve al Grado 1 | Recordar última canción, sección, tempo y filtros; botón "Continuar" en la portada |
| Melodics: puntuación confusa tras una actualización | Puntuación simple y explicada: Perfecto 100, Cerca 50, Fallo 0, × combo; tooltip en resultados |
| Melodics: suscripción cara, renovaciones sorpresa | Plan gratis útil; compra única o créditos de análisis IA; nunca cobrar por reproducir canciones propias |
| Melodics: latencia perceptible | Asistente de latencia en el primer uso; el sonido del kit sale del módulo TD-02KV; samples de la app desactivados por defecto |
| Melodics: las rachas crean hábito | Racha diaria y meta semanal visibles en la portada |
| Clone Hero: dinámica (ghost notes, acentos) y ventana de acierto visible | Ghost notes más pequeñas y tenues, acentos con ">"; puntos extra opcionales por respetar la dinámica con la velocidad MIDI |
| Rock Band: hi-hat abierto/cerrado en pads distintos | Mapear a piezas reales: hi-hat abierto = círculo sobre la nota; el pedal cuenta |
| Playdrumsonline: mezclar batería original vs. backing | Mezclador de 3 deslizadores y preset "Tocar yo la batería" |

**Principios de diseño:**
1. La línea de golpe es la protagonista: contraste máximo, el resplandor de acierto nace ahí.
2. Feedback en menos de 1 frame: el destello se pinta en el mismo `requestAnimationFrame` en que llega el MIDI.
3. Leer antes de tocar: 3–4 segundos de partitura visibles a la derecha de la línea; velocidad de scroll ajustable.
4. El video acompaña, no compite: panel inferior, nunca tapa la partitura, se oculta con una tecla.
5. Sin fricción: sin login para empezar; un pad del kit puede funcionar como play/pausa.
6. Modo oscuro por defecto.

**Boceto de diseño:** pantalla de juego, importar/análisis y resultados (ver artefacto "DrumHero AI — Boceto").

---

## 9. Formato del chart v2 (propuesta)

```json
{
  "id": "mi-cancion-001",
  "title": "[Título]",
  "artist": "[Artista]",
  "bpm": 104,
  "timeSignature": [4, 4],
  "audioUrl": "storage://…/mi-cancion.mp3",
  "youtubeUrl": null,
  "youtubeOffsetMs": 0,
  "difficulties": {
    "basic":        { "notes": [] },
    "intermediate": { "notes": [] },
    "full": {
      "notes": [
        { "t": 1.842, "piece": "kick",         "velocity": 96, "confidence": 0.93 },
        { "t": 1.842, "piece": "hihat_closed", "velocity": 72, "confidence": 0.88 },
        { "t": 2.419, "piece": "snare",        "velocity": 110, "confidence": 0.95 },
        { "t": 2.998, "piece": "tom1",         "velocity": 88, "confidence": 0.51 }
      ]
    }
  },
  "sections": [
    { "name": "Intro", "startMeasure": 1, "endMeasure": 8 }
  ]
}
```

- `t` en segundos desde el inicio del MP3 (fuente de verdad); el compás/beat se deriva del BPM y la rejilla.
- `confidence` < 0.6 marca la nota como "por revisar" en el editor.
- Piezas: `kick, snare, snare_rim, hihat_closed, hihat_open, hihat_pedal, tom1, tom2, tom3, crash, ride`.

---

## 10. Requerimientos no funcionales

- Evaluación de golpe: menos de 5 ms desde el evento MIDI hasta la calificación.
- Render a 60 fps sostenidos en el canvas.
- Desfase entre partitura y audio menor a 10 ms tras calibrar.
- Análisis IA de una canción de 4 minutos: objetivo menor a 3 minutos con GPU.
- Navegador: Chrome o Edge de escritorio (Web MIDI).
- Funciona sin conexión para canciones ya analizadas (chart y stems en IndexedDB).
- Los archivos de audio del usuario son privados y no se comparten.

---

## 11. Riesgos

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| La IA confunde toms y platillos o falla en mezclas densas | Alto | Notas de baja confianza resaltadas, editor, modo "escuchar transcripción", dificultad Básico menos sensible |
| Uso del audio de YouTube | Alto si es producto público | La IA solo procesa MP3 subidos; YouTube solo como video embebido y silenciado |
| Derechos de autor al compartir charts de canciones comerciales | Medio | No alojar ni distribuir audio; charts privados en una primera etapa |
| Costo de GPU del análisis | Medio | Cola de trabajos, GPU bajo demanda, caché por hash del archivo |
| Deriva entre video y audio | Medio | Corrección periódica de seek cuando el desfase supere 40 ms |
| Latencia variable por equipo | Medio | Asistente de calibración y perfil por dispositivo |
| Competidor directo ya en el mercado | Medio | Diferenciarse por pedagogía y experiencia, no solo transcripción |

---

## 12. Roadmap por fases

### Fase A — Prueba de concepto de IA (1–2 semanas)
- [ ] Script Python local con Demucs + ADTOF sobre 5 canciones conocidas.
- [ ] Medir a mano la precisión por pieza. Criterio de avance: bombo, caja y hi-hat > ~85%.
- [ ] Definir el esquema del chart v2 y el contrato de la API del worker.

### Fase B — Juego con chart propio (2–3 semanas)
- [ ] Reloj maestro = `audio.currentTime` del MP3.
- [ ] Cargar chart v2 en GameEngine; scroll en pentagrama con línea de golpe.
- [ ] Colores Perfecto / Cerca / Fallo, temprano/tarde, medidor de timing.
- [ ] Mezclador (batería original, backing, metrónomo) y calibración de latencia.
- [ ] Importación de MP3 + worker de análisis (Docker) + biblioteca de canciones.

### Fase C — YouTube y editor (2–3 semanas)
- [ ] Video YouTube silenciado con asistente de offset y corrección de deriva.
- [ ] Editor de partitura con notas de baja confianza.
- [ ] Modo "escuchar transcripción" y "grabar con mi kit".

### Fase D — Aprendizaje (3–4 semanas)
- [ ] Dificultades automáticas (Básico / Intermedio / Completo).
- [ ] Tempo variable, loop A–B, rampa de tempo, modo espera, práctica por capas.
- [ ] Mapa de calor por compás y "practicar mis compases más débiles".
- [ ] Rachas, metas, insignias e historial en Supabase.

---

## 13. Instrucciones para Claude Code

1. Analiza qué módulos del código actual se reutilizan (MIDI, GameEngine, HitEvaluator, renderer, stores) y cuáles hay que cambiar.
2. Propón la arquitectura: frontend actual + worker Python (FastAPI, Demucs, ADTOF) en Docker + Supabase.
3. Define el esquema JSON del chart v2 y el contrato de la API del worker.
4. Escribe `PLAN_V2.md` con las fases A–D y las tareas por fase.
5. **No escribas código todavía.** Muestra el plan y espera confirmación.
6. Una vez aprobado, trabaja feature por feature: describe → implementa → tests → commit convencional → espera confirmación.
7. Prioriza la Fase A (prueba de concepto) antes de construir la infraestructura completa.

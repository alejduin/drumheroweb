import { GOOD_WINDOW_MS, GREAT_WINDOW_MS, PERFECT_WINDOW_MS, POINTS } from '@/constants/game'
import { HitAccuracy } from '@/types'
import type { HitResult, NoteEvent } from '@/types'

// ─── Evaluador del motor v1 ───────────────────────────────────────────────────
// Lo usa GameEngineV1 mientras la app siga en el motor v1; se elimina en B8.

/**
 * Evalúa la precisión de un golpe contra una nota esperada.
 *
 * @param hitTimeMs      Tiempo del golpe desde el inicio de la canción (ms)
 * @param note           Nota esperada con absoluteTimeMs calculado
 * @param latencyOffsetMs Compensación de latencia configurada por el usuario
 */
export function evaluateHit(hitTimeMs: number, note: NoteEvent, latencyOffsetMs = 0): HitResult {
  // Aplicar compensación de latencia: si el usuario configuró +20ms,
  // sus golpes llegan 20ms tarde → los adelantamos 20ms para evaluar
  const adjustedHitTime = hitTimeMs - latencyOffsetMs
  const deltaMs = adjustedHitTime - note.absoluteTimeMs

  const accuracy = classifyAccuracy(deltaMs)

  return {
    noteEvent: note,
    accuracy,
    deltaMs,
    points: POINTS[accuracy],
  }
}

/**
 * Clasifica la precisión según el delta absoluto.
 * Exportada para que los tests puedan verificar los límites directamente.
 */
export function classifyAccuracy(deltaMs: number): HitAccuracy {
  const abs = Math.abs(deltaMs)
  if (abs <= PERFECT_WINDOW_MS) return HitAccuracy.Perfect
  if (abs <= GREAT_WINDOW_MS) return HitAccuracy.Great
  if (abs <= GOOD_WINDOW_MS) return HitAccuracy.Good
  return HitAccuracy.Miss
}

/**
 * Dado un tiempo actual de la canción, retorna si una nota ya pasó
 * sin posibilidad de ser golpeada (venció la ventana Good).
 */
export function isNoteMissed(noteAbsoluteTimeMs: number, currentTimeMs: number): boolean {
  return currentTimeMs - noteAbsoluteTimeMs > GOOD_WINDOW_MS
}

/**
 * Encuentra la nota más cercana en tiempo para un instrumento dado,
 * dentro de la ventana Good (±100ms). Retorna null si no hay candidata.
 *
 * Usado por GameEngine para hacer el matching hit → nota.
 */
export function findClosestNote(
  hitTimeMs: number,
  instrument: NoteEvent['instrument'],
  pendingNotes: NoteEvent[],
): NoteEvent | null {
  let closest: NoteEvent | null = null
  let minDelta = Infinity

  for (const note of pendingNotes) {
    if (note.instrument !== instrument) continue

    const delta = Math.abs(hitTimeMs - note.absoluteTimeMs)
    if (delta <= GOOD_WINDOW_MS && delta < minDelta) {
      minDelta = delta
      closest = note
    }
  }

  return closest
}

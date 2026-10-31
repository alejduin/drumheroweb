import type { ChartGrid, Piece } from '@/types'
import { measureRange } from '@/chart/grid'

// ─── "Grabar con mi kit" (PLAN_V2 C5) ────────────────────────────────────────
// Se elige un rango de compases; suena un compás de cuenta y se graba lo que se
// toca en el kit. Al terminar, esos golpes reemplazan las notas del rango.

/** Golpe grabado, ya en tiempo de canción (sin la latencia del kit). */
export interface RecordedHit {
  t: number
  piece: Piece
  velocity: number
}

/** Margen tras el final del rango antes de cortar: el último golpe puede llegar tarde. */
export const RECORD_TAIL_S = 0.3

/** Duración de la cuenta si no hay compás previo del que tomarla. */
const FALLBACK_COUNT_IN_S = 2

export interface RecordingPlan {
  /** Desde dónde suena la canción (un compás antes del rango, si lo hay). */
  playFromS: number
  startS: number
  endS: number
  /** Cuándo se deja de grabar. */
  stopAtS: number
}

/** Tiempos de una grabación de los compases `fromMeasure`…`toMeasure` (ambos incluidos). */
export function recordingPlan(
  grid: ChartGrid,
  durationS: number,
  fromMeasure: number,
  toMeasure: number,
): RecordingPlan {
  const { startS } = measureRange(grid, fromMeasure, durationS)
  const { endS } = measureRange(grid, Math.max(toMeasure, fromMeasure), durationS)
  const countIn =
    fromMeasure > 1
      ? startS - grid.downbeats[fromMeasure - 2]
      : grid.downbeats.length > 1
        ? grid.downbeats[1] - grid.downbeats[0]
        : FALLBACK_COUNT_IN_S
  return {
    playFromS: Math.max(0, startS - countIn),
    startS,
    endS,
    stopAtS: Math.min(endS + RECORD_TAIL_S, durationS),
  }
}

export type RecordingPhase = 'countIn' | 'recording' | 'done'

/** En qué parte de la grabación está el reloj. */
export function recordingPhase(plan: RecordingPlan, now: number): RecordingPhase {
  if (now < plan.startS) return 'countIn'
  if (now < plan.stopAtS) return 'recording'
  return 'done'
}

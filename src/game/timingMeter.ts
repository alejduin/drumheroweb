import type { HitWindows } from '@/constants/scoring'

// ─── Medidor ‹ Temprano / Tarde › ─────────────────────────────────────────────
// Muestra la tendencia del ScoreManager (media del delta de los últimos
// TIMING_TREND_HITS aciertos). La escala va de −Cerca a +Cerca del nivel activo.

/** Por debajo de esto (en valor absoluto) se considera "a tiempo". */
export const ON_TIME_TREND_MS = 5

/** Posición del punto en la barra: 0 = todo temprano, 0.5 = centro, 1 = todo tarde. */
export function meterPosition(trendMs: number | null, rangeMs: number): number {
  if (trendMs === null || !(rangeMs > 0)) return 0.5
  const fraction = 0.5 + trendMs / (2 * rangeMs)
  return Math.min(Math.max(fraction, 0), 1)
}

export type MeterTone = 'perfect' | 'close' | 'miss'

/** Verde si va a tiempo, ámbar dentro de la ventana Perfecto, rojo si se sale de ella. */
export function meterTone(trendMs: number | null, windows: HitWindows): MeterTone {
  const abs = Math.abs(trendMs ?? 0)
  if (abs < ON_TIME_TREND_MS) return 'perfect'
  return abs <= windows.perfectMs ? 'close' : 'miss'
}

/** "vas +14 ms tarde en promedio" / "vas -9 ms temprano en promedio". */
export function timingText(trendMs: number | null): string {
  if (trendMs === null) return 'toca para medir tu timing'
  const rounded = Math.round(trendMs)
  if (Math.abs(trendMs) < ON_TIME_TREND_MS) return 'vas a tiempo en promedio'
  return rounded > 0
    ? `vas +${rounded} ms tarde en promedio`
    : `vas ${rounded} ms temprano en promedio`
}

import type { ChartV2 } from '@/types'

// ─── Asistente de sincronía (PLAN_V2 C2) ─────────────────────────────────────
// El usuario mira el video (silenciado) y toca un pad en cada golpe de bombo que
// ve, empezando por el primero. Cada toque es un tiempo de video; los bombos del
// chart son tiempos de canción. offset = tiempo de video − tiempo de canción.

/** Toques que se alejan más que esto de la mediana se descartan. */
export const TAP_OUTLIER_MS = 60
/** Toques recomendados antes de calcular. */
export const MIN_TAPS = 4
/** Pasos del ajuste fino. */
export const FINE_STEP_MS = 5
export const COARSE_STEP_MS = 50

export interface OffsetEstimate {
  /** Tiempo de video = tiempo de canción + offset (ms, entero). */
  offsetMs: number
  /** Toques que entraron en la media. */
  used: number
  discarded: number
  /** Dispersión de los toques usados (desvío estándar, ms): cuánto fiarse. */
  spreadMs: number
}

/** Tiempos de los bombos del chart completo (o de todas las notas si no hay bombo). */
export function kickTimes(chart: ChartV2): number[] {
  const notes = chart.difficulties.full.notes
  const kicks = notes.filter(n => n.piece === 'kick')
  return (kicks.length ? kicks : notes).map(n => n.t).sort((a, b) => a - b)
}

/** Índice del valor de `sorted` más cercano a `t` (sorted no vacío). */
function nearestIndex(sorted: readonly number[], t: number): number {
  let lo = 0
  let hi = sorted.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < t) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(sorted[lo - 1] - t) <= Math.abs(sorted[lo] - t)) return lo - 1
  return lo
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Offset a partir de los toques (tiempos de video, s) y los bombos del chart (s).
 * El primer toque se toma como el primer bombo; cada toque se empareja con el
 * bombo más cercano y se promedian las diferencias, sin los toques atípicos.
 */
export function estimateOffset(
  tapsVideoS: readonly number[],
  kicksS: readonly number[],
): OffsetEstimate | null {
  if (!tapsVideoS.length || !kicksS.length) return null
  const taps = [...tapsVideoS].sort((a, b) => a - b)
  const anchor = taps[0] - kicksS[0]
  const diffsMs = taps.map(tap => (tap - kicksS[nearestIndex(kicksS, tap - anchor)]) * 1000)
  const center = median(diffsMs)
  const used = diffsMs.filter(d => Math.abs(d - center) <= TAP_OUTLIER_MS)
  const mean = used.reduce((sum, d) => sum + d, 0) / used.length
  const variance = used.reduce((sum, d) => sum + (d - mean) ** 2, 0) / used.length
  return {
    offsetMs: Math.round(mean),
    used: used.length,
    discarded: diffsMs.length - used.length,
    spreadMs: Math.round(Math.sqrt(variance)),
  }
}

/** Desde dónde reproducir la vista previa: un poco antes del primer bombo. */
export function previewStartS(kicksS: readonly number[], leadS = 2): number {
  return kicksS.length ? Math.max(0, kicksS[0] - leadS) : 0
}

import type { ChartGrid } from '@/types'

// ─── Latencia del kit (PLAN_V2 B10) ───────────────────────────────────────────
// El usuario golpea con 8 clicks; cada muestra es golpe − click en ms (positivo =
// el golpe llega tarde). Se descarta la peor y se promedia el resto. El valor se
// resta en HitEvaluator, así que se mide con el mismo reloj que usa el juego.

/** Clicks que se miden (después de la entrada). */
export const CALIBRATION_HITS = 8
/** Clicks de entrada (un compás de 4/4) que no se miden. */
export const COUNT_IN_BEATS = 4
/** 80 BPM: tiempo de sobra para golpear con calma. */
export const CALIBRATION_INTERVAL_S = 0.75
/** Primer click (segundos de la pista de clicks): margen para que no se corte. */
export const FIRST_CLICK_S = 0.5
/** Muestras mínimas para dar un resultado (algún golpe se puede perder). */
export const MIN_LATENCY_SAMPLES = 5
/** Un golpe a más de esto de cualquier click no cuenta (golpe accidental). */
export const MAX_HIT_DISTANCE_MS = 150
/** Por encima de esta dispersión (máx − mín de las usadas) conviene repetir. */
export const CONSISTENT_SPREAD_MS = 40

export interface LatencyResult {
  /** Promedio de las muestras usadas, redondeado al ms. */
  latencyMs: number
  /** Máx − mín de las muestras usadas. */
  spreadMs: number
  /** Muestras promediadas, en el orden recibido. */
  used: number[]
  /** La muestra descartada (la más lejana a la mediana). */
  discarded: number
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Descarta la peor muestra (la más alejada de la mediana) y promedia el resto.
 * null si hay menos de MIN_LATENCY_SAMPLES muestras válidas.
 */
export function computeLatency(samples: readonly number[]): LatencyResult | null {
  const valid = samples.filter(Number.isFinite)
  if (valid.length < MIN_LATENCY_SAMPLES) return null

  const med = median(valid)
  let worst = 0
  for (let i = 1; i < valid.length; i++) {
    if (Math.abs(valid[i] - med) > Math.abs(valid[worst] - med)) worst = i
  }
  const used = valid.filter((_, i) => i !== worst)
  const mean = used.reduce((sum, s) => sum + s, 0) / used.length
  return {
    // + 0 evita mostrar "-0 ms"
    latencyMs: Math.round(mean) + 0,
    spreadMs: Math.max(...used) - Math.min(...used),
    used,
    discarded: valid[worst],
  }
}

/** ¿Los golpes fueron lo bastante regulares como para fiarse del promedio? */
export function isConsistent(result: LatencyResult): boolean {
  return result.spreadMs <= CONSISTENT_SPREAD_MS
}

/** Rejilla de la pista de calibración: entrada + clicks medidos, acento cada 4. */
export function calibrationGrid(): ChartGrid {
  const total = COUNT_IN_BEATS + CALIBRATION_HITS
  const beats = Array.from({ length: total }, (_, i) => FIRST_CLICK_S + i * CALIBRATION_INTERVAL_S)
  return { beats, downbeats: beats.filter((_, i) => i % 4 === 0) }
}

/**
 * Click medido (0..CALIBRATION_HITS-1) más cercano a un golpe en `songT`, o null
 * si cae en la entrada o a más de MAX_HIT_DISTANCE_MS de todos.
 */
export function nearestClick(grid: ChartGrid, songT: number): number | null {
  const i = Math.round((songT - FIRST_CLICK_S) / CALIBRATION_INTERVAL_S)
  const index = i - COUNT_IN_BEATS
  if (index < 0 || index >= CALIBRATION_HITS) return null
  const distanceMs = Math.abs(songT - grid.beats[i]) * 1000
  return distanceMs <= MAX_HIT_DISTANCE_MS ? index : null
}

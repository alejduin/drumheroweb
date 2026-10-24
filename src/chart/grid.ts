import { TIME_EPSILON_S } from '@/constants/chart'
import type { ChartGrid } from '@/types'

// ─── Utilidades de rejilla ─────────────────────────────────────────────────────
// El compás y el beat se derivan de grid.beats / grid.downbeats (segundos reales),
// no de un BPM constante: las canciones reales tienen deriva de tempo (PLAN_V2 D12).

export interface MeasureBeat {
  /** Base 1 (primer downbeat = compás 1); 0 = anacrusa antes del primer downbeat. */
  measure: number
  /**
   * Base 1 y fraccionario dentro del compás (2.5 = corchea después del beat 2).
   * En el compás 0 se cuenta desde el primer beat de la rejilla.
   */
  beat: number
}

export interface TimeRange {
  startS: number
  endS: number
}

/** Cantidad de elementos de `sorted` que son <= x (+ tolerancia). */
function countAtOrBefore(sorted: readonly number[], x: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid] <= x + TIME_EPSILON_S) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Posición en beats (fraccionaria) desde grid.beats[0]. Interpola linealmente entre
 * beats y extrapola con el primer o el último intervalo fuera de la rejilla.
 */
export function beatPosition(grid: ChartGrid, t: number): number {
  const { beats } = grid
  if (beats.length < 2) return 0
  const i = Math.min(Math.max(countAtOrBefore(beats, t) - 1, 0), beats.length - 2)
  return i + (t - beats[i]) / (beats[i + 1] - beats[i])
}

export function measureCount(grid: ChartGrid): number {
  return grid.downbeats.length
}

/** Compás (base 1) que contiene t; 0 si es anterior al primer downbeat. */
export function measureAt(grid: ChartGrid, t: number): number {
  return countAtOrBefore(grid.downbeats, t)
}

export function timeToMeasureBeat(grid: ChartGrid, t: number): MeasureBeat {
  const measure = measureAt(grid, t)
  const position = beatPosition(grid, t)
  if (measure === 0) return { measure, beat: 1 + position }
  const start = beatPosition(grid, grid.downbeats[measure - 1])
  return { measure, beat: 1 + position - start }
}

/**
 * Intervalo [startS, endS) de un compás (base 1). El último termina en durationS.
 * Lanza RangeError si el compás no existe.
 */
export function measureRange(grid: ChartGrid, measure: number, durationS: number): TimeRange {
  const { downbeats } = grid
  if (!Number.isInteger(measure) || measure < 1 || measure > downbeats.length) {
    throw new RangeError(`el compás ${measure} no existe (1–${downbeats.length})`)
  }
  return {
    startS: downbeats[measure - 1],
    endS: measure < downbeats.length ? downbeats[measure] : durationS,
  }
}

import type { ChartGrid } from '@/types'
import { beatPosition } from '@/chart/grid'

// ─── Rejilla del editor (PLAN_V2 C3) ─────────────────────────────────────────
// Las posiciones se miden en beats de grid.beats (negras), así la cuantización
// sigue la deriva de tempo real de la canción.

/** Subdivisiones por beat que se pueden elegir al editar y recuantizar. */
export const DIVISIONS = [
  { value: 2, label: '1/8' },
  { value: 4, label: '1/16' },
  { value: 3, label: 'Tresillo 1/8' },
  { value: 6, label: 'Tresillo 1/16' },
] as const

export type Division = (typeof DIVISIONS)[number]['value']

export const DEFAULT_DIVISION: Division = 4

/** Mismo redondeo que el worker (4 decimales). */
export const roundTime = (t: number) => Math.round(t * 10_000) / 10_000

/** Inversa de beatPosition: tiempo de una posición en beats (extrapola fuera de la rejilla). */
export function timeAtBeatPosition(grid: ChartGrid, position: number): number {
  const { beats } = grid
  if (beats.length < 2) return beats[0] ?? 0
  const i = Math.min(Math.max(Math.floor(position), 0), beats.length - 2)
  return beats[i] + (position - i) * (beats[i + 1] - beats[i])
}

/**
 * Tiempo cuantizado a la subdivisión más cercana, `steps` casillas más allá.
 * Queda entre 0 y `durationS`.
 */
export function snapTime(
  grid: ChartGrid,
  t: number,
  division: number,
  durationS: number,
  steps = 0,
): number {
  if (grid.beats.length < 2) return roundTime(Math.min(Math.max(t, 0), durationS))
  const cell = Math.round(beatPosition(grid, t) * division) + steps
  const snapped = timeAtBeatPosition(grid, cell / division)
  return roundTime(Math.min(Math.max(snapped, 0), durationS))
}

import type { ChartGrid } from '@/types'
import type { LoopRange, TimedJudgement } from '@/engine/GameEngine'
import type { CountInClick } from '@/engine/Metronome'
import { MAX_TEMPO, TEMPO_STEP, normalizeTempo } from '@/audio/timeStretch'
import { measureAt, measureRange } from '@/chart/grid'

// ─── Práctica: loop A–B, cuenta y rampa de tempo (PLAN_V2 D3) ─────────────────

/** Precisión de una vuelta a partir de la cual sube el tempo. */
export const RAMP_THRESHOLD = 0.9
/** Cuánto sube el tempo por vuelta lograda. */
export const RAMP_STEP = TEMPO_STEP
/** Compases que abarca el loop al activarlo sin arrastrar sobre la onda. */
export const DEFAULT_LOOP_MEASURES = 4

/** Loop por compases, base 1 e inclusivo (12–15 = cuatro compases). */
export interface PracticeLoop {
  startMeasure: number
  endMeasure: number
}

/** Intervalo en segundos de canción del loop: del downbeat de A al de después de B. */
export function loopRange(grid: ChartGrid, durationS: number, loop: PracticeLoop): LoopRange {
  return {
    startS: measureRange(grid, loop.startMeasure, durationS).startS,
    endS: measureRange(grid, loop.endMeasure, durationS).endS,
  }
}

/** Loop válido dentro de la canción (A ≤ B, en 1…compases). */
export function clampLoop(grid: ChartGrid, loop: PracticeLoop): PracticeLoop | null {
  const count = grid.downbeats.length
  if (count === 0) return null
  const clamp = (m: number) => Math.min(Math.max(Math.round(m), 1), count)
  const a = clamp(Math.min(loop.startMeasure, loop.endMeasure))
  const b = clamp(Math.max(loop.startMeasure, loop.endMeasure))
  return { startMeasure: a, endMeasure: b }
}

/** Loop de los compases que toca una selección sobre la onda (de aS a bS, en cualquier orden). */
export function loopFromSelection(grid: ChartGrid, aS: number, bS: number): PracticeLoop | null {
  const from = Math.min(aS, bS)
  const to = Math.max(aS, bS)
  return clampLoop(grid, {
    startMeasure: Math.max(measureAt(grid, from), 1),
    // El final exacto en un downbeat no incluye el compás que empieza ahí
    endMeasure: Math.max(measureAt(grid, Math.max(to - 1e-3, from)), 1),
  })
}

/** Loop de DEFAULT_LOOP_MEASURES compases desde el que suena en `t`. */
export function loopAt(grid: ChartGrid, t: number): PracticeLoop | null {
  const start = Math.max(measureAt(grid, t), 1)
  return clampLoop(grid, { startMeasure: start, endMeasure: start + DEFAULT_LOOP_MEASURES - 1 })
}

/** Resultado de la última vuelta del loop. */
export interface LapResult {
  lap: number
  /** null = la vuelta no tenía notas. */
  precision: number | null
  /** Tempo con que se tocó la vuelta y el que sigue (sube con la rampa). */
  tempo: number
  nextTempo: number
}

/** "Vuelta 3: 92 % → sube a 80 %" bajo la rampa. */
export function lapText(loop: PracticeLoop | null, lap: LapResult | null, ramp: boolean): string {
  if (!loop) return 'La rampa actúa en el loop A–B (arrastra sobre la onda)'
  const range =
    loop.startMeasure === loop.endMeasure
      ? `compás ${loop.startMeasure}`
      : `compases ${loop.startMeasure}–${loop.endMeasure}`
  if (!lap) return `Loop en ${range}: al terminar cada vuelta verás su precisión`
  const precision = lap.precision === null ? 'sin notas' : `${Math.round(lap.precision * 100)} %`
  const next =
    lap.nextTempo > lap.tempo
      ? ` → sube a ${Math.round(lap.nextTempo * 100)} %`
      : ramp && lap.tempo < 1
        ? ' · con 90 % sube el tempo'
        : ''
  return `Vuelta ${lap.lap}: ${precision}${next}`
}

/** Precisión de una vuelta: (Perfecto + Cerca) / notas; null si no tuvo notas. */
export function lapPrecision(judgements: readonly TimedJudgement[]): number | null {
  let hits = 0
  let total = 0
  for (const j of judgements) {
    if (j.judgement === 'wrong_pad') continue
    total++
    if (j.judgement !== 'miss') hits++
  }
  return total === 0 ? null : hits / total
}

/** Tempo después de una vuelta: +5 % si llegó a RAMP_THRESHOLD, hasta 100 %. */
export function nextRampTempo(tempo: number, precision: number | null): number {
  if (precision === null || precision < RAMP_THRESHOLD) return tempo
  return normalizeTempo(Math.min(tempo + RAMP_STEP, MAX_TEMPO))
}

/**
 * Cuenta de un compás antes de `startS`: los `beatsPerMeasure` beats de la rejilla
 * anteriores a ese punto (el primero acentuado). Antes del inicio de la rejilla se
 * extrapola con el primer intervalo, así también hay cuenta al empezar la canción.
 */
export function countInClicks(
  grid: ChartGrid,
  startS: number,
  beatsPerMeasure: number,
): CountInClick[] {
  const { beats } = grid
  const n = Math.max(1, Math.round(beatsPerMeasure))
  if (beats.length < 2) return []
  const first = beats[1] - beats[0]
  // Índice del último beat estrictamente anterior a startS (con tolerancia)
  let last = -1
  while (last + 1 < beats.length && beats[last + 1] < startS - 1e-3) last++
  // Antes de la rejilla: el último beat extrapolado anterior a startS (índice negativo)
  if (last === -1) last = Math.ceil((startS - 1e-3 - beats[0]) / first) - 1
  const times: number[] = []
  for (let k = n - 1; k >= 0; k--) {
    const i = last - k
    times.push(i >= 0 ? beats[i] : beats[0] + i * first)
  }
  // Si startS no cae en un beat (se reanuda a mitad), el último click es el beat
  // anterior y la cuenta sigue midiendo un compás
  return times.map((t, i) => ({ t, accent: i === 0 }))
}

/** Lo que dura la cuenta en segundos de canción (del primer click hasta startS). */
export function countInLengthS(clicks: readonly CountInClick[], startS: number): number {
  return clicks.length ? Math.max(startS - clicks[0].t, 0) : 0
}

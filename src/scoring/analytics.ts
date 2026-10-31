import { PRECISION_GOOD, PRECISION_OK } from '@/constants/scoring'
import { ON_TIME_TREND_MS } from '@/game/timingMeter'
import { precisionOf } from './ScoreManager'
import type { MeasureStats, Tally } from './ScoreManager'
import type { PieceGroup } from './pieceGroups'

// ─── Análisis de la partida para Resultados (PLAN_V2 §4.5) ────────────────────

/** Compases seguidos que propone practicar el CTA (D6: "mis 4 compases más débiles"). */
export const WEAK_SPAN_MEASURES = 4

/** Notas evaluadas mínimas para que un tramo cuente como débil (evita tramos casi vacíos). */
export const WEAK_MIN_NOTES = 4

export interface WeakSpot {
  startMeasure: number
  endMeasure: number
  precision: number
  /** Grupo de piezas con menor precisión dentro del tramo. */
  group: PieceGroup | null
}

const evaluatedOf = (t: Tally) => t.perfect + t.close + t.miss

function addTally(into: Tally, t: Tally): void {
  into.perfect += t.perfect
  into.close += t.close
  into.miss += t.miss
}

/** Menor precisión; a igualdad, el grupo con más notas evaluadas. */
function weakestGroup(groups: ReadonlyMap<PieceGroup, Tally>): PieceGroup | null {
  let weakest: { group: PieceGroup; precision: number; evaluated: number } | null = null
  for (const [group, tally] of groups) {
    const precision = precisionOf(tally)
    if (precision === null) continue
    const evaluated = evaluatedOf(tally)
    if (
      !weakest ||
      precision < weakest.precision ||
      (precision === weakest.precision && evaluated > weakest.evaluated)
    ) {
      weakest = { group, precision, evaluated }
    }
  }
  return weakest?.group ?? null
}

/**
 * Tramo de `span` compases seguidos con menor precisión, si está por debajo de
 * PRECISION_GOOD. Los bordes se recortan a los compases con notas; a igualdad gana
 * el primero. Una canción más corta que `span` se evalúa entera.
 */
export function findWeakestMeasures(
  measures: readonly MeasureStats[],
  span = WEAK_SPAN_MEASURES,
): WeakSpot | null {
  const played = measures.filter(m => evaluatedOf(m.tally) > 0)
  if (played.length === 0 || span < 1) return null
  const byNumber = new Map(played.map(m => [m.measure, m]))
  const numbers = played.map(m => m.measure).sort((a, b) => a - b)
  const first = numbers[0]
  const last = numbers[numbers.length - 1]
  const width = Math.min(span, last - first + 1)

  let best: WeakSpot | null = null
  for (let start = first; start + width - 1 <= last; start++) {
    const tally: Tally = { perfect: 0, close: 0, miss: 0 }
    const groups = new Map<PieceGroup, Tally>()
    let lo = Infinity
    let hi = -Infinity
    for (let m = start; m < start + width; m++) {
      const stats = byNumber.get(m)
      if (!stats) continue
      lo = Math.min(lo, m)
      hi = Math.max(hi, m)
      addTally(tally, stats.tally)
      for (const [group, t] of Object.entries(stats.byGroup) as [PieceGroup, Tally][]) {
        const pooled = groups.get(group) ?? { perfect: 0, close: 0, miss: 0 }
        addTally(pooled, t)
        groups.set(group, pooled)
      }
    }
    if (evaluatedOf(tally) < WEAK_MIN_NOTES) continue
    const precision = precisionOf(tally)!
    if (precision >= PRECISION_GOOD) continue
    if (!best || precision < best.precision) {
      best = { startMeasure: lo, endMeasure: hi, precision, group: weakestGroup(groups) }
    }
  }
  return best
}

// ─── Distribución de golpes ───────────────────────────────────────────────────

export interface Distribution {
  perfect: number
  close: number
  miss: number
}

/** Porcentajes enteros de Perfecto / Cerca / Fallo que suman 100 (resto mayor). */
export function distributionOf(tally: Tally): Distribution | null {
  const total = evaluatedOf(tally)
  if (total === 0) return null
  const keys = ['perfect', 'close', 'miss'] as const
  const exact = keys.map(k => (tally[k] * 100) / total)
  const result = exact.map(Math.floor)
  let left = 100 - result.reduce((a, b) => a + b, 0)
  const order = keys
    .map((_, i) => i)
    .sort((a, b) => exact[b] - Math.floor(exact[b]) - (exact[a] - Math.floor(exact[a])))
  for (const i of order) {
    if (left <= 0) break
    result[i]++
    left--
  }
  return { perfect: result[0], close: result[1], miss: result[2] }
}

// ─── Timing ───────────────────────────────────────────────────────────────────

export interface TimingTendency {
  text: string
  tone: 'perfect' | 'close'
}

/** Subtítulo de la tarjeta TIMING a partir de la media de todos los aciertos. */
export function timingTendency(meanDeltaMs: number | null): TimingTendency | null {
  if (meanDeltaMs === null) return null
  if (Math.abs(meanDeltaMs) < ON_TIME_TREND_MS) return { text: 'vas a tiempo', tone: 'perfect' }
  return {
    text: meanDeltaMs > 0 ? 'tiendes a ir tarde' : 'tiendes a ir temprano',
    tone: 'close',
  }
}

// ─── Titular ──────────────────────────────────────────────────────────────────

/** Cambio de precisión global (fracción) que el titular considera mejora o retroceso. */
export const HEADLINE_DELTA = 0.02

/** Cambio de precisión de una sección para nombrarla como "mejoraste en …". */
export const SECTION_IMPROVEMENT = 0.05

export interface SectionPrecision {
  name: string
  startMeasure: number
  precision: number | null
}

export interface HeadlineStats {
  precision: number | null
  sections: readonly SectionPrecision[]
}

const sameSection = (a: SectionPrecision, b: SectionPrecision) =>
  a.name === b.name && a.startMeasure === b.startMeasure

/** Sección tocada con menor precisión, si está por debajo de PRECISION_GOOD. */
function weakestSection(sections: readonly SectionPrecision[]): SectionPrecision | null {
  let weakest: SectionPrecision | null = null
  for (const s of sections) {
    if (s.precision === null || s.precision >= PRECISION_GOOD) continue
    if (!weakest || s.precision < weakest.precision!) weakest = s
  }
  return weakest
}

/** Sección que más mejoró respecto de la partida anterior (al menos SECTION_IMPROVEMENT). */
function mostImproved(
  current: readonly SectionPrecision[],
  previous: readonly SectionPrecision[],
): SectionPrecision | null {
  let best: { section: SectionPrecision; gain: number } | null = null
  for (const s of current) {
    const before = previous.find(p => sameSection(p, s))
    if (s.precision === null || before?.precision == null) continue
    const gain = s.precision - before.precision
    if (gain >= SECTION_IMPROVEMENT - 1e-9 && (!best || gain > best.gain))
      best = { section: s, gain }
  }
  return best?.section ?? null
}

/** Titular de Resultados: compara con la partida anterior de la misma canción. */
export function buildHeadline(current: HeadlineStats, previous: HeadlineStats | null): string {
  const { precision } = current
  if (precision === null) return 'No se evaluó ninguna nota'

  if (previous?.precision == null) {
    if (precision >= PRECISION_GOOD) return '¡Gran primera partida!'
    if (precision >= PRECISION_OK) return 'Buen comienzo: ya tienes la base'
    return 'Primera partida: la siguiente sale mejor'
  }

  const delta = precision - previous.precision
  const weakest = weakestSection(current.sections)
  if (delta >= HEADLINE_DELTA - 1e-9) {
    const improved = mostImproved(current.sections, previous.sections)
    if (improved) return `Buen trabajo: mejoraste en ${improved.name}`
    return `Buen trabajo: tu precisión subió ${Math.round(delta * 100)} puntos`
  }
  if (delta <= -HEADLINE_DELTA + 1e-9) {
    return weakest ? `Hoy costó más: ${weakest.name} pide práctica` : 'Hoy costó un poco más'
  }
  if (precision >= PRECISION_GOOD) return 'Sólido: mantienes el nivel'
  return weakest ? `Como la última vez: ${weakest.name} pide práctica` : 'Como la última vez'
}

// ─── Precisión por compás (mapa de calor) ─────────────────────────────────────

export interface MeasureBar {
  measure: number
  /** null = compás sin notas evaluadas. */
  precision: number | null
}

/** Una barra por compás de la canción (1…total), con hueco en los compases sin notas. */
export function measureBars(
  measures: readonly MeasureStats[],
  totalMeasures: number,
): MeasureBar[] {
  const byNumber = new Map(measures.map(m => [m.measure, m.precision]))
  const last = Math.max(totalMeasures, ...measures.map(m => m.measure))
  return Array.from({ length: Math.max(last, 0) }, (_, i) => ({
    measure: i + 1,
    precision: byNumber.get(i + 1) ?? null,
  }))
}

export interface MeasureSpan {
  name: string
  /** 0–1 sobre el total de compases (regla bajo el mapa de calor). */
  start: number
  end: number
}

export function measureSpans(
  sections: readonly { name: string; startMeasure: number; endMeasure: number }[],
  totalMeasures: number,
): MeasureSpan[] {
  if (totalMeasures <= 0) return []
  const at = (m: number) => Math.min(Math.max(m / totalMeasures, 0), 1)
  return sections.map(s => ({
    name: s.name,
    start: at(s.startMeasure - 1),
    end: at(s.endMeasure),
  }))
}

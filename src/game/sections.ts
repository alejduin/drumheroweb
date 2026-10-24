import { PRECISION_GOOD } from '@/constants/scoring'
import type { ChartGrid, ChartSection, ChartV2 } from '@/types'
import type { SectionStats } from '@/scoring/ScoreManager'

// ─── Secciones de la partida ──────────────────────────────────────────────────

/** Compases por sección cuando el chart no trae secciones (charts de IA, hasta el editor). */
export const AUTO_SECTION_MEASURES = 8

/** Tempo sugerido para practicar una sección floja (la práctica llega en la Fase D). */
export const PRACTICE_TEMPO = 0.75

/** Secciones del chart o, si no tiene, bloques automáticos de AUTO_SECTION_MEASURES compases. */
export function effectiveSections(
  chart: Pick<ChartV2, 'sections' | 'grid'>,
): readonly ChartSection[] {
  if (chart.sections.length > 0) return chart.sections
  const measures = chart.grid.downbeats.length
  const sections: ChartSection[] = []
  for (let start = 1; start <= measures; start += AUTO_SECTION_MEASURES) {
    const end = Math.min(start + AUTO_SECTION_MEASURES - 1, measures)
    sections.push({ name: `Compases ${start}–${end}`, startMeasure: start, endMeasure: end })
  }
  return sections
}

/** Índice de la sección que contiene el compás, o -1 (antes del compás 1 o fuera). */
export function sectionIndexAt(sections: readonly ChartSection[], measure: number): number {
  return sections.findIndex(s => measure >= s.startMeasure && measure <= s.endMeasure)
}

/** Inicio de una sección en segundos (su primer downbeat). */
export function sectionStartS(grid: ChartGrid, section: ChartSection): number {
  return grid.downbeats[section.startMeasure - 1] ?? 0
}

export interface SectionSpan {
  name: string
  /** 0–1 sobre la duración de la canción (regla bajo la forma de onda). */
  start: number
  end: number
}

/** Etiqueta corta para la regla: las secciones automáticas muestran solo su primer compás. */
export function rulerLabel(section: ChartSection, auto: boolean): string {
  return auto ? String(section.startMeasure) : section.name
}

export function sectionSpans(
  sections: readonly ChartSection[],
  grid: ChartGrid,
  durationS: number,
  label: (section: ChartSection) => string = s => s.name,
): SectionSpan[] {
  if (!(durationS > 0)) return []
  const at = (t: number) => Math.min(Math.max(t / durationS, 0), 1)
  return sections.map(section => ({
    name: label(section),
    start: at(sectionStartS(grid, section)),
    end: at(grid.downbeats[section.endMeasure] ?? durationS),
  }))
}

export interface PracticeSuggestion {
  startMeasure: number
  endMeasure: number
  tempo: number
}

/** Sección tocada con menor precisión, si está por debajo de PRECISION_GOOD. */
export function practiceSuggestion(stats: readonly SectionStats[]): PracticeSuggestion | null {
  let weakest: SectionStats | null = null
  for (const s of stats) {
    if (s.precision === null || s.precision >= PRECISION_GOOD) continue
    if (!weakest || s.precision < weakest.precision!) weakest = s
  }
  return weakest
    ? { startMeasure: weakest.startMeasure, endMeasure: weakest.endMeasure, tempo: PRACTICE_TEMPO }
    : null
}

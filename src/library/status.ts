import { PIECES } from '@/types'
import type { ChartV2, JobSummary, Piece } from '@/types'
import { LOW_CONFIDENCE_THRESHOLD } from '@/constants/chart'

// ─── Estado de una canción en la biblioteca ──────────────────────────────────

export type SongStatus = 'analyzing' | 'ready' | 'needs_review' | 'failed'

/** Desde esta fracción de notas dudosas la canción se marca "por revisar". */
export const NEEDS_REVIEW_FRACTION = 0.1

/** Notas de la dificultad completa con confianza baja. */
export function lowConfidenceCount(chart: ChartV2): number {
  return chart.difficulties.full.notes.filter(n => n.confidence < LOW_CONFIDENCE_THRESHOLD).length
}

/** ready o needs_review según cuántas notas quedaron dudosas. */
export function statusForChart(chart: ChartV2): Exclude<SongStatus, 'analyzing' | 'failed'> {
  const total = chart.difficulties.full.notes.length
  if (total === 0) return 'needs_review'
  return lowConfidenceCount(chart) / total >= NEEDS_REVIEW_FRACTION ? 'needs_review' : 'ready'
}

export const STATUS_LABELS: Record<SongStatus, string> = {
  analyzing: 'Analizando',
  ready: 'Lista',
  needs_review: 'Por revisar',
  failed: 'Error',
}

/** Resumen del análisis calculado del chart (igual que `summary` del worker, pero sin red). */
export function summaryFromChart(chart: ChartV2): JobSummary {
  const notes = chart.difficulties.full.notes
  const present = new Set(notes.map(n => n.piece))
  const lowConfidenceByPiece: Partial<Record<Piece, number>> = {}
  for (const note of notes) {
    if (note.confidence < LOW_CONFIDENCE_THRESHOLD) {
      lowConfidenceByPiece[note.piece] = (lowConfidenceByPiece[note.piece] ?? 0) + 1
    }
  }
  return {
    bpm: chart.bpm,
    timeSignature: chart.timeSignature,
    durationS: chart.durationS,
    pieces: PIECES.filter(p => present.has(p)),
    lowConfidenceCount: lowConfidenceCount(chart),
    lowConfidenceByPiece,
  }
}

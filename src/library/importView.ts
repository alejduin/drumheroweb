import { ANALYSIS_STAGE_IDS } from '@/types'
import type { AnalysisStageId, JobSummary, Piece } from '@/types'
import type { TrackerState } from './jobTracker'

// ─── Lo que muestra el panel de análisis de Importar (puro) ──────────────────

/** Mismos textos que el worker (worker/app/api/stages.py), para antes de la primera respuesta. */
export const STAGE_LABELS: Record<AnalysisStageId, string> = {
  separate: 'Separar la batería del resto',
  transcribe: 'Detectar golpes por pieza',
  tempo: 'Detectar tempo y compases',
  quantize: 'Cuantizar a la rejilla',
  difficulties: 'Generar 3 dificultades',
}

export interface StageRowView {
  id: AnalysisStageId
  label: string
  state: 'pending' | 'running' | 'done' | 'failed'
  progress: number
  statusText?: string
}

export function stageRows(tracker: TrackerState | null): StageRowView[] {
  const stages = tracker?.job?.stages
  const done = tracker?.phase === 'downloading' || tracker?.phase === 'done'
  return ANALYSIS_STAGE_IDS.map(id => {
    const stage = stages?.find(s => s.id === id)
    const label = stage?.label ?? STAGE_LABELS[id]
    if (done) return { id, label, state: 'done', progress: 1 }
    if (!stage) return { id, label, state: 'pending', progress: 0 }
    // El worker aún no informa el avance dentro de una etapa
    const statusText = stage.state === 'running' && stage.progress === 0 ? 'en curso' : undefined
    return { id, label, state: stage.state, progress: stage.progress, statusText }
  })
}

/** Una línea sobre lo que pasa ahora (subida, cola, descarga, error). */
export function trackerHeadline(tracker: TrackerState | null): string {
  if (!tracker) return 'Elige un archivo para empezar'
  switch (tracker.phase) {
    case 'uploading':
      return 'Subiendo el audio al worker…'
    case 'analyzing':
      if (tracker.networkFailures > 0) return 'Sin conexión con el worker, reintentando…'
      return tracker.job?.status === 'queued' ? 'En cola…' : 'Analizando…'
    case 'downloading':
      return 'Guardando la partitura y los stems…'
    case 'done':
      return tracker.cached ? 'Listo (ya estaba analizada)' : 'Listo'
    case 'failed':
      return tracker.error?.message ?? 'El análisis falló'
    case 'canceled':
      return 'Cancelado'
  }
}

// Piezas agrupadas como se nombran en la pantalla ("Bombo, caja, hi-hat, toms, crash")
const PIECE_GROUPS: Record<Piece, string> = {
  kick: 'bombo',
  snare: 'caja',
  snare_rim: 'caja',
  hihat_closed: 'hi-hat',
  hihat_open: 'hi-hat',
  hihat_pedal: 'hi-hat',
  tom1: 'toms',
  tom2: 'toms',
  tom3: 'toms',
  crash: 'crash',
  ride: 'ride',
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export function piecesText(pieces: readonly Piece[]): string {
  const groups = [...new Set(pieces.map(p => PIECE_GROUPS[p]))]
  return groups.length ? capitalize(groups.join(', ')) : '—'
}

/** "baja confianza, sobre todo toms" (el grupo con más notas dudosas). */
export function lowConfidenceHint(summary: JobSummary): string {
  const byGroup = new Map<string, number>()
  for (const [piece, count] of Object.entries(summary.lowConfidenceByPiece) as Array<
    [Piece, number]
  >) {
    const group = PIECE_GROUPS[piece]
    byGroup.set(group, (byGroup.get(group) ?? 0) + count)
  }
  const [top] = [...byGroup].sort((a, b) => b[1] - a[1])
  if (!top || summary.lowConfidenceCount === 0) return 'todo con buena confianza'
  return `baja confianza, sobre todo ${top[0]}`
}

import type { ReferenceFile, ReferenceHit, ReferenceTake } from '@/types'

/** Decimales de `t` en el archivo (0.1 ms, igual que el chart del worker). */
const TIME_DECIMALS = 4

export interface RecordingState {
  takes: ReferenceTake[]
  hits: ReferenceHit[]
}

export const EMPTY_RECORDING: RecordingState = { takes: [], hits: [] }

/**
 * Mismo algoritmo que song_id_from_name (worker/app/pipeline/chart.py):
 * 'Enter Sandman.mp3' → 'Enter-Sandman'. Así A5 empareja referencia y canción.
 */
export function songIdFromFileName(fileName: string, fallback: string): string {
  const stem = fileName.replace(/\.[^./\\]*$/, '')
  const slug = stem
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 128)
  return slug || fallback
}

/**
 * Integra una toma: los golpes anteriores dentro de [startS, endS] se reemplazan
 * por los de la toma (regrabar un pasaje lo corrige). Retorna un estado nuevo.
 */
export function mergeTake(
  state: RecordingState,
  take: ReferenceTake,
  takeHits: readonly ReferenceHit[],
): RecordingState {
  if (take.endS <= take.startS) return state
  const inTake = (t: number) => t >= take.startS && t <= take.endS
  const kept = state.hits.filter(h => !inTake(h.t))
  const added = takeHits.filter(h => inTake(h.t))
  return {
    takes: [...state.takes, take],
    hits: [...kept, ...added].sort((a, b) => a.t - b.t || a.note - b.note),
  }
}

/** Segundos de canción cubiertos por al menos una toma (unión de intervalos). */
export function coveredSeconds(takes: readonly ReferenceTake[]): number {
  const sorted = [...takes].filter(k => k.endS > k.startS).sort((a, b) => a.startS - b.startS)
  let total = 0
  let curStart = -Infinity
  let curEnd = -Infinity
  for (const { startS, endS } of sorted) {
    if (startS > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart
      curStart = startS
      curEnd = endS
    } else {
      curEnd = Math.max(curEnd, endS)
    }
  }
  if (curEnd > curStart) total += curEnd - curStart
  return total
}

export function countByPiece(hits: readonly ReferenceHit[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const hit of hits) counts[hit.piece] = (counts[hit.piece] ?? 0) + 1
  return counts
}

export function buildReferenceFile(
  state: RecordingState,
  meta: Omit<ReferenceFile, 'version' | 'takes' | 'hits'>,
): ReferenceFile {
  const round = (t: number) => Number(t.toFixed(TIME_DECIMALS))
  return {
    version: 1,
    ...meta,
    takes: state.takes.map(k => ({ startS: round(k.startS), endS: round(k.endS) })),
    hits: state.hits.map(h => ({ ...h, t: round(h.t) })),
  }
}

/** Valida un borrador guardado (localStorage puede tener basura o una versión vieja). */
export function parseRecordingDraft(raw: string | null): RecordingState | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Partial<RecordingState>
    if (!Array.isArray(data.takes) || !Array.isArray(data.hits)) return null
    const hitsOk = data.hits.every(
      h =>
        typeof h?.t === 'number' &&
        typeof h.piece === 'string' &&
        typeof h.note === 'number' &&
        typeof h.velocity === 'number',
    )
    const takesOk = data.takes.every(
      k => typeof k?.startS === 'number' && typeof k.endS === 'number',
    )
    return hitsOk && takesOk ? { takes: data.takes, hits: data.hits } : null
  } catch {
    return null
  }
}

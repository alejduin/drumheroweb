import type { ChartSourceKind, ChartV2, Difficulty, Level } from '@/types'

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  basic: 'Básico',
  intermediate: 'Intermedio',
  full: 'Completo',
}

const SOURCE_LABELS: Record<ChartSourceKind, string> = {
  ai: 'transcrita por IA',
  manual: 'editada a mano',
  builtin: 'incluida en la app',
}

/**
 * "Completo · 104 BPM · 4/4 · transcrita por IA" (bajo el título del header).
 * A otro tempo, el BPM que suena: "Completo · 78 BPM (75 %) · 4/4 · …".
 */
export function songMeta(
  chart: Pick<ChartV2, 'bpm' | 'timeSignature' | 'source'>,
  difficulty: Difficulty,
  tempo = 1,
): string {
  const [beats, unit] = chart.timeSignature
  const bpm = `${Math.round(chart.bpm * tempo)} BPM`
  return [
    DIFFICULTY_LABELS[difficulty],
    tempo === 1 ? bpm : `${bpm} (${Math.round(tempo * 100)} %)`,
    `${beats}/${unit}`,
    SOURCE_LABELS[chart.source.kind],
  ].join(' · ')
}

export const LEVEL_LABELS: Record<Level, string> = {
  beginner: 'Principiante',
  intermediate: 'Intermedio',
  expert: 'Experto',
}

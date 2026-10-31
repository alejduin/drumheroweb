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

/** "Completo · 104 BPM · 4/4 · transcrita por IA" (bajo el título del header). */
export function songMeta(
  chart: Pick<ChartV2, 'bpm' | 'timeSignature' | 'source'>,
  difficulty: Difficulty,
): string {
  const [beats, unit] = chart.timeSignature
  return [
    DIFFICULTY_LABELS[difficulty],
    `${Math.round(chart.bpm)} BPM`,
    `${beats}/${unit}`,
    SOURCE_LABELS[chart.source.kind],
  ].join(' · ')
}

export const LEVEL_LABELS: Record<Level, string> = {
  beginner: 'Principiante',
  intermediate: 'Intermedio',
  expert: 'Experto',
}

import type { ChartNote, Piece } from '@/types'

// ─── Práctica por capas (PLAN_V2 D5) ──────────────────────────────────────────
// Se toca solo una parte del kit y se va sumando: bombo y caja → + hi-hat → todo.
// Es independiente de la dificultad: filtra las notas que esa dificultad ya tiene.

export const PRACTICE_LAYERS = ['kick_snare', 'hihat', 'full'] as const
export type PracticeLayer = (typeof PRACTICE_LAYERS)[number]

export const LAYER_LABELS: Record<PracticeLayer, string> = {
  kick_snare: 'Bombo y caja',
  hihat: '+ Hi-hat',
  full: 'Kit completo',
}

const KICK_SNARE: readonly Piece[] = ['kick', 'snare', 'snare_rim']
const HIHAT: readonly Piece[] = ['hihat_closed', 'hihat_open', 'hihat_pedal']

/** Piezas de cada capa; null = todas. */
export const LAYER_PIECES: Record<PracticeLayer, ReadonlySet<Piece> | null> = {
  kick_snare: new Set(KICK_SNARE),
  hihat: new Set([...KICK_SNARE, ...HIHAT]),
  full: null,
}

/** Las notas de la capa, en el mismo orden (el array original si es el kit completo). */
export function filterLayer(
  notes: readonly ChartNote[],
  layer: PracticeLayer,
): readonly ChartNote[] {
  const pieces = LAYER_PIECES[layer]
  return pieces ? notes.filter(n => pieces.has(n.piece)) : notes
}

export function isPracticeLayer(value: unknown): value is PracticeLayer {
  return typeof value === 'string' && (PRACTICE_LAYERS as readonly string[]).includes(value)
}

import type { Piece } from '@/types'

// ─── Piezas agrupadas (Resultados: Bombo, Caja, Hi-hat, Toms, Platillos) ─────

export const PIECE_GROUPS = ['kick', 'snare', 'hihat', 'toms', 'cymbals'] as const

export type PieceGroup = (typeof PIECE_GROUPS)[number]

export const PIECE_GROUP_OF: Readonly<Record<Piece, PieceGroup>> = {
  kick: 'kick',
  snare: 'snare',
  snare_rim: 'snare',
  hihat_closed: 'hihat',
  hihat_open: 'hihat',
  hihat_pedal: 'hihat',
  tom1: 'toms',
  tom2: 'toms',
  tom3: 'toms',
  crash: 'cymbals',
  ride: 'cymbals',
}

export const PIECE_GROUP_LABELS: Readonly<Record<PieceGroup, string>> = {
  kick: 'Bombo',
  snare: 'Caja',
  hihat: 'Hi-hat',
  toms: 'Toms',
  cymbals: 'Platillos',
}

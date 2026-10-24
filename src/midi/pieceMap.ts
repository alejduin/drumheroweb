import type { Piece } from '@/types'

/**
 * Mapa por defecto nota MIDI → pieza del chart v2 (Roland TD-02KV, coincide con
 * General MIDI, así que también sirve un teclado MIDI).
 * Incluye tom3 = 43 y el borde del ride (59) como ride (PLAN_V2 D5).
 * B2 migra midiMap.ts (V1) a este mapa.
 */
export const DEFAULT_PIECE_MAP: Readonly<Record<number, Piece>> = {
  36: 'kick',
  38: 'snare',
  40: 'snare_rim',
  42: 'hihat_closed',
  44: 'hihat_pedal',
  46: 'hihat_open',
  48: 'tom1',
  45: 'tom2',
  43: 'tom3',
  49: 'crash',
  51: 'ride',
  59: 'ride',
}

export function pieceForNote(
  note: number,
  map: Readonly<Record<number, Piece>> = DEFAULT_PIECE_MAP,
): Piece | undefined {
  return map[note]
}

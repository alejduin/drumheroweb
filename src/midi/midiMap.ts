import type { Piece } from '@/types'

/**
 * Mapa por defecto nota MIDI → pieza (Roland TD-02KV; coincide con General MIDI,
 * así que también sirve un teclado MIDI). Incluye tom3 = 43 y el borde del
 * ride (59) como ride (PLAN_V2 D5). El usuario lo ajusta en la calibración.
 */
export const DEFAULT_MIDI_MAP: Readonly<Record<number, Piece>> = {
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

/**
 * Resuelve una nota MIDI a una pieza usando el mapa dado.
 * Retorna undefined si la nota no está mapeada.
 */
export function resolveInstrument(
  midiNote: number,
  map: Readonly<Record<number, Piece>> = DEFAULT_MIDI_MAP,
): Piece | undefined {
  return map[midiNote]
}

/**
 * Invierte el mapa (pieza → nota MIDI). Si varias notas van a la misma pieza
 * (51 y 59 → ride) gana la de menor número.
 * Útil para la pantalla de calibración.
 */
export function invertMidiMap(
  map: Readonly<Record<number, Piece>>,
): Partial<Record<Piece, number>> {
  const result: Partial<Record<Piece, number>> = {}
  for (const [note, piece] of Object.entries(map)) {
    if (result[piece] === undefined) result[piece] = Number(note)
  }
  return result
}

/**
 * Migra un mapa guardado con V1: `ride_edge` pasa a `ride` y se agrega tom3 (43)
 * si esa nota no está asignada. Descarta valores que ya no son piezas.
 */
export function migrateMidiMap(map: Readonly<Record<number, string>>): Record<number, Piece> {
  const pieces = new Set<string>(Object.values(DEFAULT_MIDI_MAP))
  const result: Record<number, Piece> = {}
  for (const [note, value] of Object.entries(map)) {
    const piece = value === 'ride_edge' ? 'ride' : value
    if (pieces.has(piece)) result[Number(note)] = piece as Piece
  }
  if (result[43] === undefined) result[43] = 'tom3'
  return result
}

import { PIECES } from '@/types'
import type { Piece } from '@/types'

// ─── Mapeo MIDI por pieza (PLAN_V2 B10) ───────────────────────────────────────

export const PIECE_LABELS: Record<Piece, string> = {
  kick: 'Bombo',
  snare: 'Caja',
  snare_rim: 'Aro de caja',
  hihat_closed: 'Hi-hat cerrado',
  hihat_open: 'Hi-hat abierto',
  hihat_pedal: 'Hi-hat pedal',
  tom1: 'Tom 1',
  tom2: 'Tom 2',
  tom3: 'Tom 3',
  crash: 'Crash',
  ride: 'Ride',
}

/** Cómo tocar la pieza al asignarla (el hi-hat da notas distintas según el pedal). */
export const PIECE_HINTS: Partial<Record<Piece, string>> = {
  snare_rim: 'golpe de aro (rimshot)',
  hihat_closed: 'con el pedal pisado',
  hihat_open: 'con el pedal suelto',
  hihat_pedal: 'pisando el pedal, sin golpear',
}

type MidiMap = Readonly<Record<number, Piece>>

/** Notas asignadas a cada pieza, de menor a mayor. */
export function notesByPiece(map: MidiMap): Record<Piece, number[]> {
  const result = Object.fromEntries(PIECES.map(p => [p, [] as number[]])) as Record<Piece, number[]>
  for (const [note, piece] of Object.entries(map)) result[piece]?.push(Number(note))
  for (const piece of PIECES) result[piece].sort((a, b) => a - b)
  return result
}

/**
 * Asigna `note` a `piece`. Si la nota era de otra pieza, se mueve. Las otras
 * notas de la pieza se conservan (p. ej. 51 y 59 del ride).
 */
export function assignNote(map: MidiMap, note: number, piece: Piece): Record<number, Piece> {
  return { ...map, [note]: piece }
}

export function removeNote(map: MidiMap, note: number): Record<number, Piece> {
  const result = { ...map }
  delete result[note]
  return result
}

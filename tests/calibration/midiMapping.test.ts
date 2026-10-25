import { describe, expect, it } from 'vitest'
import { PIECES } from '@/types'
import { PIECE_LABELS, assignNote, notesByPiece, removeNote } from '@/calibration/midiMapping'
import { DEFAULT_MIDI_MAP } from '@/midi/midiMap'

describe('midiMapping', () => {
  it('notas por pieza, ordenadas (ride con 51 y 59)', () => {
    const byPiece = notesByPiece(DEFAULT_MIDI_MAP)
    expect(byPiece.ride).toEqual([51, 59])
    expect(byPiece.tom3).toEqual([43])
    expect(Object.keys(byPiece)).toEqual([...PIECES])
  })

  it('assignNote mueve la nota de pieza sin tocar el resto ni mutar el mapa', () => {
    const map = assignNote(DEFAULT_MIDI_MAP, 38, 'tom1')
    expect(map[38]).toBe('tom1')
    expect(notesByPiece(map).tom1).toEqual([38, 48])
    expect(notesByPiece(map).snare).toEqual([])
    expect(DEFAULT_MIDI_MAP[38]).toBe('snare')
    expect(assignNote({}, 37, 'snare')).toEqual({ 37: 'snare' })
  })

  it('removeNote quita solo esa nota', () => {
    const map = removeNote(DEFAULT_MIDI_MAP, 59)
    expect(map[59]).toBeUndefined()
    expect(map[51]).toBe('ride')
    expect(DEFAULT_MIDI_MAP[59]).toBe('ride')
  })

  it('todas las piezas tienen etiqueta', () => {
    for (const piece of PIECES) expect(PIECE_LABELS[piece]).toBeTruthy()
  })
})

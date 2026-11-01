import { describe, expect, it } from 'vitest'
import type { ChartNote, Piece } from '@/types'
import { PRACTICE_LAYERS, filterLayer, isPracticeLayer } from '@/chart/layers'

const note = (t: number, piece: Piece): ChartNote => ({ t, piece, velocity: 80, confidence: 1 })

// Un compás con todas las piezas, en orden de tiempo
const NOTES: ChartNote[] = [
  note(0, 'kick'),
  note(0, 'crash'),
  note(0.25, 'hihat_closed'),
  note(0.5, 'snare'),
  note(0.5, 'hihat_open'),
  note(0.75, 'hihat_pedal'),
  note(1, 'snare_rim'),
  note(1, 'ride'),
  note(1.25, 'tom1'),
  note(1.5, 'tom2'),
  note(1.75, 'tom3'),
]

const pieces = (notes: readonly ChartNote[]) => notes.map(n => n.piece)

describe('filterLayer (D5)', () => {
  it('bombo y caja: bombo, caja y aro', () => {
    expect(pieces(filterLayer(NOTES, 'kick_snare'))).toEqual(['kick', 'snare', 'snare_rim'])
  })

  it('+ hi-hat suma cerrado, abierto y pedal, en orden de tiempo', () => {
    expect(pieces(filterLayer(NOTES, 'hihat'))).toEqual([
      'kick',
      'hihat_closed',
      'snare',
      'hihat_open',
      'hihat_pedal',
      'snare_rim',
    ])
  })

  it('el kit completo devuelve las mismas notas sin copiar', () => {
    expect(filterLayer(NOTES, 'full')).toBe(NOTES)
  })

  it('cada capa contiene a la anterior', () => {
    const counts = PRACTICE_LAYERS.map(l => filterLayer(NOTES, l).length)
    expect(counts).toEqual([3, 6, NOTES.length])
  })

  it('sin notas de la capa queda vacía', () => {
    expect(filterLayer([note(0, 'crash'), note(1, 'tom1')], 'kick_snare')).toEqual([])
  })

  it('isPracticeLayer valida lo guardado', () => {
    expect(isPracticeLayer('hihat')).toBe(true)
    expect(isPracticeLayer('toms')).toBe(false)
    expect(isPracticeLayer(undefined)).toBe(false)
  })
})

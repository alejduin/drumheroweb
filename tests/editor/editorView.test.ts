import { describe, expect, it } from 'vitest'
import type { ChartNote } from '@/types'
import { editorTimeline, noteAt, pieceAtY, xToTime } from '@/editor/editorView'
import { ALL_FUTURE } from '@/renderer/noteStates'
import { buildStaffModel, createStaffGeometry, layoutStaff, pieceY } from '@/renderer/staffLayout'

const geometry = createStaffGeometry(300)
const grid = { beats: [0, 0.5, 1, 1.5, 2], downbeats: [0] }
const notes: ChartNote[] = [
  { t: 0.5, piece: 'kick', velocity: 90, confidence: 1 },
  { t: 0.5, piece: 'hihat_closed', velocity: 90, confidence: 1 },
  { t: 1, piece: 'snare', velocity: 90, confidence: 1 },
]

describe('canvas del editor', () => {
  const timeline = editorTimeline(1200)
  const frame = layoutStaff(buildStaffModel(notes, grid), geometry, timeline, 0, ALL_FUTURE)
  const x = (t: number) => t * timeline.pxPerSecond

  it('x ↔ tiempo con la vista desplazada', () => {
    expect(xToTime(timeline, 10, x(1))).toBe(11)
  })

  it('la altura del clic da la pieza del pentagrama', () => {
    expect(pieceAtY(geometry, pieceY(geometry, 'kick'))).toBe('kick')
    expect(pieceAtY(geometry, pieceY(geometry, 'snare') + 2)).toBe('snare')
    expect(pieceAtY(geometry, pieceY(geometry, 'crash') - 30)).toBe('crash')
  })

  it('encuentra la nota bajo el clic dentro de un acorde', () => {
    // Índices en el orden del chart
    expect(noteAt(frame, geometry, x(0.5), pieceY(geometry, 'kick'))).toBe(0)
    expect(noteAt(frame, geometry, x(0.5) + 4, pieceY(geometry, 'hihat_closed'))).toBe(1)
    expect(noteAt(frame, geometry, x(1), pieceY(geometry, 'snare'))).toBe(2)
  })

  it('un clic lejos de las cabezas no elige nada', () => {
    expect(noteAt(frame, geometry, x(0.75), pieceY(geometry, 'kick'))).toBeNull()
    expect(noteAt(frame, geometry, x(1), pieceY(geometry, 'kick'))).toBeNull()
  })
})

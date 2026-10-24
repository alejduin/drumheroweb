import { describe, expect, it } from 'vitest'
import type { ChartNote, Piece } from '@/types'
import { PIECES } from '@/types'
import {
  LANE_OF,
  LANE_ORDER,
  createLaneGeometry,
  laneY,
  lanesForNotes,
  layoutLanes,
} from '@/renderer/laneLayout'
import { ALL_FUTURE } from '@/renderer/noteStates'
import { measureBars } from '@/renderer/staffLayout'
import { createTimeline } from '@/renderer/timeline'

const note = (t: number, piece: Piece, velocity = 90): ChartNote => ({
  t,
  piece,
  velocity,
  confidence: 1,
})

describe('carriles', () => {
  it('variantes de la misma pieza comparten carril', () => {
    expect(LANE_OF.hihat_open).toBe('hihat')
    expect(LANE_OF.hihat_closed).toBe('hihat')
    expect(LANE_OF.snare_rim).toBe('snare')
    expect(new Set(PIECES.map(p => LANE_OF[p]))).toEqual(new Set(LANE_ORDER))
  })

  it('solo los carriles que usa el chart, en orden del kit', () => {
    const notes = [note(0, 'kick'), note(0, 'hihat_open'), note(1, 'snare_rim'), note(2, 'crash')]
    expect(lanesForNotes(notes)).toEqual(['crash', 'hihat', 'snare', 'kick'])
    expect(lanesForNotes([])).toEqual([...LANE_ORDER])
  })

  it('reparte la altura disponible entre los carriles', () => {
    const geometry = createLaneGeometry(300, ['hihat', 'snare', 'kick'])
    const h = 242 / 3
    geometry.lanes.forEach((lane, i) => {
      expect(lane.top).toBeCloseTo(20 + i * h, 9)
      expect(lane.centerY).toBeCloseTo(20 + (i + 0.5) * h, 9)
    })
    expect(laneY(geometry, 'hihat_pedal')).toBeNull()
    expect(laneY(geometry, 'snare_rim')).toBe(geometry.lanes[1].centerY)
  })

  it('layout: notas visibles en su carril, ghost más chica, barras de compás', () => {
    const notes = [
      note(0, 'snare', 30),
      note(0.5, 'snare', 120),
      note(1, 'hihat_open'),
      note(30, 'kick'),
    ]
    const geometry = createLaneGeometry(300, lanesForNotes(notes))
    const timeline = createTimeline(1400)
    const frame = layoutLanes(
      notes,
      measureBars({ beats: [0, 0.5], downbeats: [0, 2, 4] }),
      geometry,
      timeline,
      0,
      ALL_FUTURE,
    )
    expect(frame.notes.map(n => n.noteIndex)).toEqual([0, 1, 2]) // t = 30 queda fuera
    expect(frame.notes[0].x).toBe(timeline.hitX)
    expect(frame.notes[0].radius).toBeLessThan(frame.notes[1].radius)
    expect(frame.notes[1].accent).toBe(true)
    expect(frame.notes[2].open).toBe(true)
    expect(frame.notes[2].y).toBe(laneY(geometry, 'hihat_closed'))
    expect(frame.bars.map(b => b.measure)).toEqual([1, 2]) // t = 4 cae fuera de los 3,5 s
  })
})

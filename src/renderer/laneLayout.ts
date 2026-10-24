import type { ChartNote, Piece } from '@/types'
import { noteDynamic } from '@/chart/notes'
import type { NoteStateSource, NoteVisualState } from './noteStates'
import type { MeasureBar } from './staffLayout'
import { timeToX, visibleSlice, visibleWindow } from './timeline'
import type { Timeline } from './timeline'

// ─── Vista Carriles ───────────────────────────────────────────────────────────
// Un carril por pieza (variantes de la misma pieza comparten carril), de arriba
// abajo como en el kit. Funciones puras; LaneRenderer solo pinta.

export const LANE_ORDER = [
  'crash',
  'ride',
  'hihat',
  'tom1',
  'snare',
  'tom2',
  'tom3',
  'kick',
  'hihat_pedal',
] as const

export type LaneId = (typeof LANE_ORDER)[number]

export const LANE_OF: Record<Piece, LaneId> = {
  crash: 'crash',
  ride: 'ride',
  hihat_closed: 'hihat',
  hihat_open: 'hihat',
  tom1: 'tom1',
  snare: 'snare',
  snare_rim: 'snare',
  tom2: 'tom2',
  tom3: 'tom3',
  kick: 'kick',
  hihat_pedal: 'hihat_pedal',
}

export const LANE_LABELS: Record<LaneId, string> = {
  crash: 'Crash',
  ride: 'Ride',
  hihat: 'Hi-hat',
  tom1: 'Tom 1',
  snare: 'Caja',
  tom2: 'Tom 2',
  tom3: 'Tom 3',
  kick: 'Bombo',
  hihat_pedal: 'HH pie',
}

/** Carriles que usa el chart, en orden del kit; todos si no hay notas. */
export function lanesForNotes(notes: readonly ChartNote[]): LaneId[] {
  const used = new Set(notes.map(n => LANE_OF[n.piece]))
  return used.size === 0 ? [...LANE_ORDER] : LANE_ORDER.filter(lane => used.has(lane))
}

export interface Lane {
  id: LaneId
  top: number
  height: number
  centerY: number
}

/** Mismo panel de 300 px de referencia que el pentagrama. */
const REFERENCE_HEIGHT = 300

export interface LaneGeometry {
  scale: number
  lanes: Lane[]
  laneOf: Partial<Record<LaneId, Lane>>
  top: number
  bottom: number
  noteRadius: number
  labelX: number
  marginPx: number
}

export function createLaneGeometry(height: number, lanes: readonly LaneId[]): LaneGeometry {
  const scale = height / REFERENCE_HEIGHT
  const top = 20 * scale
  const bottom = 262 * scale // debajo va la barra DOM (medidor y leyenda)
  const laneHeight = (bottom - top) / Math.max(lanes.length, 1)
  const layout = lanes.map((id, i) => ({
    id,
    top: top + i * laneHeight,
    height: laneHeight,
    centerY: top + (i + 0.5) * laneHeight,
  }))
  return {
    scale,
    lanes: layout,
    laneOf: Object.fromEntries(layout.map(lane => [lane.id, lane])),
    top,
    bottom,
    noteRadius: Math.min(laneHeight * 0.34, 11 * scale),
    labelX: 16 * scale,
    marginPx: 32 * scale,
  }
}

/** Centro del carril de una pieza; null si el carril no se muestra. */
export function laneY(geometry: LaneGeometry, piece: Piece): number | null {
  return geometry.laneOf[LANE_OF[piece]]?.centerY ?? null
}

export interface LaneNoteLayout {
  noteIndex: number
  x: number
  y: number
  radius: number
  open: boolean
  accent: boolean
  state: NoteVisualState
}

export interface LaneFrame {
  notes: LaneNoteLayout[]
  bars: { x: number; measure: number }[]
}

export function layoutLanes(
  notes: readonly ChartNote[],
  bars: readonly MeasureBar[],
  geometry: LaneGeometry,
  timeline: Timeline,
  now: number,
  states: NoteStateSource,
): LaneFrame {
  const { fromT, toT } = visibleWindow(timeline, now, geometry.marginPx)
  const frame: LaneFrame = { notes: [], bars: [] }

  const [start, end] = visibleSlice(notes, fromT, toT)
  for (let i = start; i < end; i++) {
    const note = notes[i]
    const y = laneY(geometry, note.piece)
    if (y === null) continue
    const dynamic = noteDynamic(note)
    frame.notes.push({
      noteIndex: i,
      x: timeToX(timeline, note.t, now),
      y,
      radius: geometry.noteRadius * (dynamic === 'ghost' ? 0.7 : 1),
      open: note.piece === 'hihat_open',
      accent: dynamic === 'accent',
      state: states.stateOf(i),
    })
  }

  const [barStart, barEnd] = visibleSlice(bars, fromT, toT)
  for (let b = barStart; b < barEnd; b++) {
    frame.bars.push({ x: timeToX(timeline, bars[b].t, now), measure: bars[b].measure })
  }
  return frame
}

import type { ChartGrid, ChartNote, Piece } from '@/types'
import { beatPosition } from '@/chart/grid'
import { noteDynamic } from '@/chart/notes'
import type { NoteStateSource, NoteVisualState } from './noteStates'
import { timeToX, visibleSlice, visibleWindow } from './timeline'
import type { Timeline } from './timeline'

// ─── Pentagrama de batería (PLAN_V2 §4.3, boceto) ─────────────────────────────
// Funciones puras: del chart y el instante actual salen posiciones; StaffRenderer
// solo pinta. Las medidas salen de la maqueta Main.dc.html (panel de 300 px).

export type HeadShape = 'x' | 'filled'

/**
 * Posición vertical en medios espacios desde la línea superior (0 = 5.ª línea,
 * 8 = 1.ª línea); negativo = encima del pentagrama.
 */
export interface StaffPosition {
  step: number
  head: HeadShape
}

export const STAFF_POSITIONS: Record<Piece, StaffPosition> = {
  crash: { step: -2, head: 'x' }, // X con línea adicional
  hihat_closed: { step: -1, head: 'x' }, // X sobre la línea superior
  hihat_open: { step: -1, head: 'x' }, // + "o" encima
  ride: { step: 0, head: 'x' }, // X en la línea superior
  tom1: { step: 1, head: 'filled' }, // 4.º espacio
  tom2: { step: 2, head: 'filled' }, // 4.ª línea
  snare: { step: 3, head: 'filled' }, // 3.er espacio
  snare_rim: { step: 3, head: 'x' }, // golpe de aro: X en la altura de la caja
  tom3: { step: 5, head: 'filled' }, // 2.º espacio
  kick: { step: 7, head: 'filled' }, // 1.er espacio
  hihat_pedal: { step: 9, head: 'x' }, // X bajo el pentagrama
}

/** Alto del panel de la maqueta; todas las medidas escalan respecto a él. */
export const STAFF_REFERENCE_HEIGHT = 300

export interface StaffGeometry {
  scale: number
  topLineY: number
  lineSpacing: number
  stemTopY: number
  beamThickness: number
  beamGap: number
  headRx: number
  headRy: number
  ghostScale: number
  ledgerHalfWidth: number
  /** Separación de la barra de compás antes del primer tiempo del compás. */
  barLeadPx: number
  openMarkY: number
  accentY: number
  measureNumberY: number
  labelY: number
  /** Margen de culling a cada lado del canvas. */
  marginPx: number
}

export function createStaffGeometry(height: number): StaffGeometry {
  const s = height / STAFF_REFERENCE_HEIGHT
  return {
    scale: s,
    topLineY: 120 * s,
    lineSpacing: 24 * s,
    stemTopY: 64 * s,
    beamThickness: 6 * s,
    beamGap: 4 * s,
    headRx: 8 * s,
    headRy: 6 * s,
    ghostScale: 0.7,
    ledgerHalfWidth: 13 * s,
    barLeadPx: 24 * s,
    openMarkY: 52 * s,
    accentY: 36 * s,
    measureNumberY: 236 * s,
    labelY: 252 * s,
    marginPx: 48 * s,
  }
}

export function stepY(geometry: StaffGeometry, step: number): number {
  return geometry.topLineY + (step * geometry.lineSpacing) / 2
}

export function pieceY(geometry: StaffGeometry, piece: Piece): number {
  return stepY(geometry, STAFF_POSITIONS[piece].step)
}

/** Líneas adicionales (en steps) que necesita una cabeza fuera del pentagrama. */
export function ledgerSteps(step: number): number[] {
  const steps: number[] = []
  for (let s = -2; s >= step; s -= 2) steps.push(s)
  for (let s = 10; s <= step; s += 2) steps.push(s)
  return steps
}

// ─── Modelo estático (una vez por chart) ──────────────────────────────────────

/** Notas a menos de esto se tocan juntas (misma plica). */
export const CHORD_EPSILON_S = 0.002
const BEAT_EPSILON = 0.02

/** Barras por figura: 0 = negra o más larga, 1 = corchea, 2 = semicorchea, 3 = fusa. */
export type BeamLevel = 0 | 1 | 2 | 3

/** Barra que une la plica de un acorde con la del siguiente en el mismo beat. */
export interface BeamLink {
  to: number // índice del acorde siguiente
  level: number // 1 = barra principal
}

/** Barra corta de un acorde cuyo vecino tiene menos barras (corchea con puntillo + semi). */
export interface BeamStub {
  level: number
  direction: 1 | -1
}

export interface StaffChord {
  t: number
  /** Índices de nota, de arriba abajo en el pentagrama. */
  noteIndices: number[]
  beat: number // beat de la rejilla al que pertenece (agrupación de barras)
  beamLevel: BeamLevel
  links: BeamLink[]
  stubs: BeamStub[]
  /** Único acorde de su beat con figura más corta que la negra: lleva corchete. */
  flag: boolean
}

export interface MeasureBar {
  t: number // downbeat
  measure: number // base 1
}

export interface StaffModel {
  notes: readonly ChartNote[]
  chords: StaffChord[]
  bars: MeasureBar[]
}

/** Barras de compás desde la rejilla (una por downbeat). */
export function measureBars(grid: ChartGrid): MeasureBar[] {
  return grid.downbeats.map((t, i) => ({ t, measure: i + 1 }))
}

function levelForDuration(beats: number): BeamLevel {
  if (beats >= 1 - BEAT_EPSILON) return 0
  if (beats >= 1 / 3 - BEAT_EPSILON) return 1 // corcheas (y tresillos de corchea)
  if (beats >= 1 / 6 - BEAT_EPSILON) return 2
  return 3
}

/** Agrupa notas simultáneas en acordes y calcula las barras por beat. */
export function buildStaffModel(notes: readonly ChartNote[], grid: ChartGrid): StaffModel {
  const chords: StaffChord[] = []
  const positions: number[] = []
  const hasGrid = grid.beats.length >= 2

  for (let i = 0; i < notes.length; i++) {
    const last = chords[chords.length - 1]
    if (last && notes[i].t - last.t <= CHORD_EPSILON_S) {
      last.noteIndices.push(i)
      continue
    }
    const position = hasGrid ? beatPosition(grid, notes[i].t) : chords.length
    positions.push(position)
    chords.push({
      t: notes[i].t,
      noteIndices: [i],
      beat: Math.floor(position + BEAT_EPSILON),
      beamLevel: 0,
      links: [],
      stubs: [],
      flag: false,
    })
  }

  for (const chord of chords) {
    chord.noteIndices.sort(
      (a, b) => STAFF_POSITIONS[notes[a].piece].step - STAFF_POSITIONS[notes[b].piece].step,
    )
  }

  // Duración de cada acorde dentro de su beat → cantidad de barras
  for (let c = 0; c < chords.length; c++) {
    const next = chords[c + 1]
    const end = next && next.beat === chords[c].beat ? positions[c + 1] : chords[c].beat + 1
    chords[c].beamLevel = hasGrid ? levelForDuration(end - positions[c]) : 0
  }

  // Barras entre vecinos del mismo beat; corchete si el acorde va solo
  let groupStart = 0
  for (let c = 0; c <= chords.length; c++) {
    if (c < chords.length && chords[c].beat === chords[groupStart].beat) continue
    linkGroup(chords, groupStart, c)
    groupStart = c
  }

  return { notes, chords, bars: measureBars(grid) }
}

function linkGroup(chords: StaffChord[], start: number, end: number): void {
  if (end - start === 1) {
    chords[start].flag = chords[start].beamLevel > 0
    return
  }
  for (let c = start; c < end; c++) {
    const level = chords[c].beamLevel
    const prev = c > start ? chords[c - 1].beamLevel : 0
    const next = c + 1 < end ? chords[c + 1].beamLevel : 0
    // La barra principal une todo el grupo aunque haya una negra en medio
    if (c + 1 < end) {
      chords[c].links.push({ to: c + 1, level: 1 })
      for (let l = 2; l <= Math.min(level, next); l++) chords[c].links.push({ to: c + 1, level: l })
    }
    for (let l = Math.max(prev, next, 1) + 1; l <= level; l++) {
      chords[c].stubs.push({ level: l, direction: c === start ? 1 : -1 })
    }
  }
}

// ─── Layout de un frame ───────────────────────────────────────────────────────

export type ChordLabel = 'fallo' | 'temprano' | 'tarde'

export interface HeadLayout {
  noteIndex: number
  piece: Piece
  y: number
  shape: HeadShape
  ghost: boolean
  open: boolean
  state: NoteVisualState
}

export interface ChordLayout {
  chord: number
  x: number
  stemX: number
  stemBottomY: number
  heads: HeadLayout[]
  /** Color de la plica: el de la primera cabeza ya juzgada, de arriba abajo. */
  stemState: NoteVisualState
  accent: boolean
  label: ChordLabel | null
}

export interface BeamLayout {
  x1: number
  x2: number
  y: number
  state: NoteVisualState
}

export interface FlagLayout {
  x: number
  y: number
  level: number
  state: NoteVisualState
}

export interface LedgerLayout {
  x1: number
  x2: number
  y: number
}

export interface BarLayout {
  x: number
  measure: number
}

export interface StaffFrame {
  chords: ChordLayout[]
  beams: BeamLayout[]
  flags: FlagLayout[]
  ledgers: LedgerLayout[]
  bars: BarLayout[]
}

export function beamY(geometry: StaffGeometry, level: number): number {
  return (
    geometry.stemTopY +
    geometry.beamThickness / 2 +
    (level - 1) * (geometry.beamThickness + geometry.beamGap)
  )
}

export function layoutStaff(
  model: StaffModel,
  geometry: StaffGeometry,
  timeline: Timeline,
  now: number,
  states: NoteStateSource,
): StaffFrame {
  const { fromT, toT } = visibleWindow(timeline, now, geometry.marginPx)
  const [start, end] = visibleSlice(model.chords, fromT, toT)
  const frame: StaffFrame = { chords: [], beams: [], flags: [], ledgers: [], bars: [] }

  const stemXOf = (c: number) =>
    timeToX(timeline, model.chords[c].t, now) + geometry.headRx - geometry.scale
  const chordLayouts = new Map<number, ChordLayout>()

  for (let c = start; c < end; c++) {
    const layout = layoutChord(model, geometry, timeline, now, states, c)
    chordLayouts.set(c, layout)
    frame.chords.push(layout)
    for (const head of layout.heads) {
      for (const step of ledgerSteps(STAFF_POSITIONS[head.piece].step)) {
        frame.ledgers.push({
          x1: layout.x - geometry.ledgerHalfWidth,
          x2: layout.x + geometry.ledgerHalfWidth,
          y: stepY(geometry, step),
        })
      }
    }
  }

  // Las barras que entran desde un acorde fuera de pantalla (a la izquierda) también se pintan
  for (let c = Math.max(start - 1, 0); c < end; c++) {
    const chord = model.chords[c]
    const stemState =
      chordLayouts.get(c)?.stemState ??
      layoutChord(model, geometry, timeline, now, states, c).stemState
    const x = stemXOf(c)
    for (const link of chord.links) {
      frame.beams.push({
        x1: x,
        x2: stemXOf(link.to),
        y: beamY(geometry, link.level),
        state: stemState,
      })
    }
    for (const stub of chord.stubs) {
      const length = geometry.headRx * 1.4
      frame.beams.push({
        x1: stub.direction === 1 ? x : x - length,
        x2: stub.direction === 1 ? x + length : x,
        y: beamY(geometry, stub.level),
        state: stemState,
      })
    }
    if (chord.flag && c >= start) {
      frame.flags.push({ x, y: geometry.stemTopY, level: chord.beamLevel, state: stemState })
    }
  }

  const [barStart, barEnd] = visibleSlice(
    model.bars,
    fromT,
    toT + geometry.barLeadPx / timeline.pxPerSecond,
  )
  for (let b = barStart; b < barEnd; b++) {
    const bar = model.bars[b]
    frame.bars.push({ x: timeToX(timeline, bar.t, now) - geometry.barLeadPx, measure: bar.measure })
  }
  return frame
}

function layoutChord(
  model: StaffModel,
  geometry: StaffGeometry,
  timeline: Timeline,
  now: number,
  states: NoteStateSource,
  c: number,
): ChordLayout {
  const chord = model.chords[c]
  const x = timeToX(timeline, chord.t, now)
  const heads: HeadLayout[] = []
  let stemState: NoteVisualState = 'future'
  let accent = false
  let label: ChordLabel | null = null
  let bottom = -Infinity

  for (const noteIndex of chord.noteIndices) {
    const note = model.notes[noteIndex]
    const position = STAFF_POSITIONS[note.piece]
    const dynamic = noteDynamic(note)
    const state = states.stateOf(noteIndex)
    const y = stepY(geometry, position.step)
    heads.push({
      noteIndex,
      piece: note.piece,
      y,
      shape: position.head,
      ghost: dynamic === 'ghost',
      open: note.piece === 'hihat_open',
      state,
    })
    bottom = Math.max(bottom, y)
    if (dynamic === 'accent') accent = true
    if (stemState === 'future') stemState = state
    if (state === 'miss') label = 'fallo'
    else if (state === 'close' && label === null) {
      label = states.timingOf(noteIndex) === 'early' ? 'temprano' : 'tarde'
    }
  }

  return {
    chord: c,
    x,
    stemX: x + geometry.headRx - geometry.scale,
    stemBottomY: bottom,
    heads,
    stemState,
    accent,
    label,
  }
}

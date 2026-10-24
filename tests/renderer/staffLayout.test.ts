import { describe, expect, it } from 'vitest'
import type { ChartGrid, ChartNote, Piece } from '@/types'
import { PIECES } from '@/types'
import { ALL_FUTURE } from '@/renderer/noteStates'
import type { NoteStateSource, NoteVisualState } from '@/renderer/noteStates'
import {
  STAFF_POSITIONS,
  beamY,
  buildStaffModel,
  createStaffGeometry,
  layoutStaff,
  ledgerSteps,
  pieceY,
  stepY,
} from '@/renderer/staffLayout'
import { createTimeline, timeToX } from '@/renderer/timeline'
import { buildDemoChart } from '@/ui/screens/dev/demoChart'

// 120 BPM: beat = 0.5 s, compás = 2 s, el compás 1 empieza en t = 0
const GRID: ChartGrid = {
  beats: Array.from({ length: 64 }, (_, i) => i * 0.5),
  downbeats: Array.from({ length: 16 }, (_, i) => i * 2),
}
const geometry = createStaffGeometry(300)
const timeline = createTimeline(1400)

const note = (t: number, piece: Piece = 'snare', velocity = 90): ChartNote => ({
  t,
  piece,
  velocity,
  confidence: 1,
})

function states(map: Record<number, NoteVisualState>, early: number[] = []): NoteStateSource {
  return {
    stateOf: i => map[i] ?? 'future',
    timingOf: i => (map[i] === 'close' ? (early.includes(i) ? 'early' : 'late') : null),
  }
}

describe('posiciones por pieza (boceto)', () => {
  it('coinciden con la maqueta: líneas en 120…216 y cabezas en su espacio', () => {
    expect([0, 2, 4, 6, 8].map(s => stepY(geometry, s))).toEqual([120, 144, 168, 192, 216])
    const y = (p: Piece) => pieceY(geometry, p)
    expect(y('crash')).toBe(96) // línea adicional
    expect(y('hihat_closed')).toBe(108) // sobre la línea superior
    expect(y('ride')).toBe(120) // en la línea superior
    expect(y('tom1')).toBe(132) // 4.º espacio
    expect(y('tom2')).toBe(144) // 4.ª línea
    expect(y('snare')).toBe(156) // 3.er espacio
    expect(y('tom3')).toBe(180) // 2.º espacio
    expect(y('kick')).toBe(204) // 1.er espacio
    expect(y('hihat_pedal')).toBe(228) // bajo el pentagrama
  })

  it('platillos y hi-hat con X; caja, toms y bombo con cabeza llena', () => {
    const xs = PIECES.filter(p => STAFF_POSITIONS[p].head === 'x')
    expect(xs).toEqual(['snare_rim', 'hihat_closed', 'hihat_open', 'hihat_pedal', 'crash', 'ride'])
  })

  it('solo el crash necesita línea adicional', () => {
    expect(ledgerSteps(STAFF_POSITIONS.crash.step)).toEqual([-2])
    expect(PIECES.filter(p => ledgerSteps(STAFF_POSITIONS[p].step).length > 0)).toEqual(['crash'])
    expect(ledgerSteps(-5)).toEqual([-2, -4])
    expect(ledgerSteps(11)).toEqual([10])
  })

  it('escala con la altura del canvas', () => {
    const half = createStaffGeometry(150)
    expect(pieceY(half, 'snare')).toBe(78)
    expect(half.headRx).toBe(4)
  })
})

describe('acordes y barras por beat', () => {
  it('notas simultáneas comparten plica, ordenadas de arriba abajo', () => {
    const model = buildStaffModel(
      [note(0, 'kick'), note(0, 'hihat_closed'), note(0.001, 'snare')],
      GRID,
    )
    expect(model.chords).toHaveLength(1)
    expect(model.chords[0].noteIndices.map(i => model.notes[i].piece)).toEqual([
      'hihat_closed',
      'snare',
      'kick',
    ])
  })

  it('corcheas: una barra por beat, sin unir beats distintos', () => {
    const model = buildStaffModel(
      [0, 0.25, 0.5, 0.75].map(t => note(t, 'hihat_closed')),
      GRID,
    )
    expect(model.chords.map(c => [c.beat, c.beamLevel])).toEqual([
      [0, 1],
      [0, 1],
      [1, 1],
      [1, 1],
    ])
    expect(model.chords[0].links).toEqual([{ to: 1, level: 1 }])
    expect(model.chords[1].links).toEqual([]) // el beat siguiente es otro grupo
  })

  it('semicorcheas: dos barras entre vecinas', () => {
    const model = buildStaffModel(
      [0, 0.125, 0.25, 0.375].map(t => note(t)),
      GRID,
    )
    expect(model.chords.map(c => c.beamLevel)).toEqual([2, 2, 2, 2])
    expect(model.chords[0].links).toEqual([
      { to: 1, level: 1 },
      { to: 1, level: 2 },
    ])
    expect(model.chords.flatMap(c => c.stubs)).toEqual([])
  })

  it('corchea con puntillo + semicorchea: barra corta hacia la izquierda', () => {
    const model = buildStaffModel([note(0), note(0.375)], GRID)
    expect(model.chords.map(c => c.beamLevel)).toEqual([1, 2])
    expect(model.chords[0].links).toEqual([{ to: 1, level: 1 }])
    expect(model.chords[1].stubs).toEqual([{ level: 2, direction: -1 }])
  })

  it('semicorchea + corchea con puntillo: barra corta hacia la derecha', () => {
    const model = buildStaffModel([note(0), note(0.125)], GRID)
    expect(model.chords.map(c => c.beamLevel)).toEqual([2, 1])
    expect(model.chords[0].stubs).toEqual([{ level: 2, direction: 1 }])
  })

  it('negras sin barra; una corchea sola en su beat lleva corchete', () => {
    const model = buildStaffModel([note(0), note(0.5), note(1.25)], GRID)
    expect(model.chords.map(c => [c.beamLevel, c.flag])).toEqual([
      [0, false],
      [0, false],
      [1, true], // en el "y" del beat 3, sola
    ])
  })

  it('tresillos de corchea cuentan como corcheas', () => {
    const model = buildStaffModel(
      [0, 1 / 6, 2 / 6].map(t => note(t)),
      GRID,
    )
    expect(model.chords.map(c => c.beamLevel)).toEqual([1, 1, 1])
  })

  it('con tempo variable el beat sale de la rejilla, no del BPM', () => {
    const grid: ChartGrid = { beats: [0, 0.5, 1.2, 1.9], downbeats: [0] }
    const model = buildStaffModel([note(0.5), note(0.85), note(1.2)], grid)
    expect(model.chords.map(c => [c.beat, c.beamLevel])).toEqual([
      [1, 1],
      [1, 1],
      [2, 0],
    ])
  })
})

describe('layout de un frame', () => {
  it('x proporcional al tiempo: en la línea de golpe cuando t = ahora', () => {
    const model = buildStaffModel([note(4), note(5)], GRID)
    const frame = layoutStaff(model, geometry, timeline, 4, ALL_FUTURE)
    expect(frame.chords[0].x).toBe(timeline.hitX)
    expect(frame.chords[1].x - frame.chords[0].x).toBeCloseTo(timeline.pxPerSecond, 6)
  })

  it('culling: solo los acordes que caben, con margen', () => {
    const notes = Array.from({ length: 200 }, (_, i) => note(i * 0.25))
    const model = buildStaffModel(notes, GRID)
    const now = 20
    const frame = layoutStaff(model, geometry, timeline, now, ALL_FUTURE)
    const xs = frame.chords.map(c => c.x)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-geometry.marginPx)
    expect(Math.max(...xs)).toBeLessThanOrEqual(timeline.width + geometry.marginPx)
    // todo lo que cae dentro del canvas está
    const inside = notes.filter(n => {
      const x = timeToX(timeline, n.t, now)
      return x >= 0 && x <= timeline.width
    })
    expect(frame.chords.length).toBeGreaterThanOrEqual(inside.length)
    expect(frame.chords.length).toBeLessThan(notes.length)
  })

  it('la barra que entra desde un acorde fuera de pantalla se pinta', () => {
    const model = buildStaffModel([note(0), note(0.25)], GRID)
    // ahora tal que el primer acorde quedó fuera por la izquierda y el segundo no
    const now = 0.25 + (timeline.hitX - 10) / timeline.pxPerSecond
    const frame = layoutStaff(model, geometry, timeline, now, ALL_FUTURE)
    expect(frame.chords.map(c => c.chord)).toEqual([1])
    expect(frame.beams).toHaveLength(1)
    expect(frame.beams[0].x1).toBeLessThan(0)
    expect(frame.beams[0].y).toBe(beamY(geometry, 1))
  })

  it('compases: barra antes del downbeat y número de compás', () => {
    const model = buildStaffModel([note(2), note(4)], GRID)
    const frame = layoutStaff(model, geometry, timeline, 2, ALL_FUTURE)
    const bar2 = frame.bars.find(b => b.measure === 2)!
    expect(bar2.x).toBe(timeline.hitX - geometry.barLeadPx)
    expect(frame.bars.map(b => b.measure)).toEqual([2, 3]) // ~0,9 s detrás y 3,5 s delante
  })

  it('plica desde la cabeza más baja; color de la primera cabeza juzgada', () => {
    const notes = [
      note(0, 'hihat_closed'),
      note(0, 'kick'),
      note(0.5, 'hihat_closed'),
      note(0.5, 'snare'),
    ]
    const model = buildStaffModel(notes, GRID)
    const frame = layoutStaff(model, geometry, timeline, 0, states({ 1: 'miss', 3: 'perfect' }))
    const [c0, c1] = frame.chords
    expect(c0.stemBottomY).toBe(pieceY(geometry, 'kick'))
    expect(c0.stemState).toBe('miss') // el hi-hat aún no se juzgó
    expect(c1.stemState).toBe('perfect')
    expect(c0.stemX).toBeGreaterThan(c0.x)
  })

  it('etiquetas: fallo antes que temprano/tarde', () => {
    const notes = [note(0, 'hihat_closed'), note(0, 'kick'), note(0.5), note(1)]
    const model = buildStaffModel(notes, GRID)
    const frame = layoutStaff(
      model,
      geometry,
      timeline,
      0,
      states({ 0: 'close', 1: 'miss', 2: 'close', 3: 'close' }, [2]),
    )
    expect(frame.chords.map(c => c.label)).toEqual(['fallo', 'temprano', 'tarde'])
  })

  it('ghost, acento y hi-hat abierto', () => {
    const notes = [note(0, 'snare', 30), note(0.5, 'snare', 120), note(1, 'hihat_open')]
    const frame = layoutStaff(buildStaffModel(notes, GRID), geometry, timeline, 0, ALL_FUTURE)
    expect(frame.chords.map(c => [c.heads[0].ghost, c.accent, c.heads[0].open])).toEqual([
      [true, false, false],
      [false, true, false],
      [false, false, true],
    ])
  })
})

describe('rendimiento', () => {
  it('2 000 notas: modelo una vez y layout por frame muy por debajo de 16 ms', () => {
    const chart = buildDemoChart(2000)
    const notes = chart.difficulties.full.notes
    expect(notes.length).toBeGreaterThanOrEqual(2000)
    const model = buildStaffModel(notes, chart.grid)
    const frames = 600
    const start = performance.now()
    for (let f = 0; f < frames; f++) {
      layoutStaff(model, geometry, timeline, (f / frames) * chart.durationS, ALL_FUTURE)
    }
    const perFrame = (performance.now() - start) / frames
    expect(perFrame).toBeLessThan(1)
  })
})

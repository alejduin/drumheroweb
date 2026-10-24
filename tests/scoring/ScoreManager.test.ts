import { describe, expect, it } from 'vitest'
import type { ChartNote, ChartSection, Level, Piece } from '@/types'
import { DYNAMIC_BONUS_POINTS, TIMING_TREND_HITS, multiplierFor } from '@/constants/scoring'
import { HitEvaluator } from '@/engine/HitEvaluator'
import type { TimedJudgement } from '@/engine/GameEngine'
import { ScoreManager, precisionOf, sectionForMeasure } from '@/scoring/ScoreManager'

// Rejilla 120 BPM en 4/4: compás n empieza en (n − 1) × 2 s
const GRID = {
  beats: Array.from({ length: 80 }, (_, i) => i * 0.5),
  downbeats: Array.from({ length: 20 }, (_, i) => i * 2),
}
const SECTIONS: ChartSection[] = [
  { name: 'Intro', startMeasure: 1, endMeasure: 2 },
  { name: 'Verso', startMeasure: 3, endMeasure: 10 },
]

/** Una nota por corchea desde t = 0, con la pieza dada por índice. */
function notesFor(count: number, piece: (i: number) => Piece = () => 'snare'): ChartNote[] {
  return Array.from({ length: count }, (_, i) => ({
    t: i * 0.25,
    piece: piece(i),
    velocity: 80,
    confidence: 1,
  }))
}

/**
 * Juicios reales: evalúa un desfase por nota con el HitEvaluator (null = Fallo,
 * 'wrong' = golpe en otro pad y Fallo).
 */
function play(
  notes: ChartNote[],
  offsetsMs: Array<number | null | 'wrong'>,
  level: Level = 'intermediate',
) {
  const evaluator = new HitEvaluator(notes, { level, dynamicsBonus: true })
  const log: TimedJudgement[] = []
  notes.forEach((n, i) => {
    const offset = offsetsMs[i % offsetsMs.length]
    if (typeof offset === 'number') {
      const j = evaluator.judge({ t: n.t + offset / 1000, piece: n.piece, velocity: 80 })
      log.push({ ...j, t: n.t })
    } else {
      if (offset === 'wrong')
        log.push({ ...evaluator.judge({ t: n.t, piece: 'ride', velocity: 80 }), t: n.t })
      // justo tras cerrar la ventana de esta nota, antes de abrir la siguiente
      const closeS = evaluator.windows.closeMs / 1000
      for (const miss of evaluator.expire(n.t + closeS + 0.005))
        log.push({ ...miss, t: notes[miss.noteIndex].t })
    }
  })
  for (const miss of evaluator.expire(Infinity)) log.push({ ...miss, t: notes[miss.noteIndex].t })
  return log
}

function manager(notes: ChartNote[]) {
  return new ScoreManager({ notes, grid: GRID, sections: SECTIONS })
}

describe('puntos por nivel', () => {
  it.each<[Level, number, number]>([
    ['beginner', 100, 50],
    ['intermediate', 100, 50],
    ['expert', 100, 40],
  ])('%s: Perfecto %i, Cerca %i (con x1)', (level, perfect, close) => {
    const notes = notesFor(2)
    const closeOffset = level === 'expert' ? 30 : 60
    const scores = manager(notes)
    for (const j of play(notes, [0, closeOffset], level)) scores.apply(j)
    expect(scores.snapshot().score).toBe(perfect + close)
  })
})

describe('combo y multiplicador', () => {
  it.each([
    [9, 1],
    [10, 2],
    [24, 2],
    [25, 3],
    [49, 3],
    [50, 4],
  ])('combo %i → x%i', (combo, multiplier) => {
    expect(multiplierFor(combo)).toBe(multiplier)
    const notes = notesFor(combo)
    const scores = manager(notes)
    for (const j of play(notes, [0])) scores.apply(j)
    expect(scores.snapshot()).toMatchObject({ combo, multiplier })
  })

  it('el golpe que llega a 10 ya suma con x2', () => {
    const notes = notesFor(10)
    const scores = manager(notes)
    for (const j of play(notes, [0])) scores.apply(j)
    expect(scores.snapshot().score).toBe(9 * 100 + 100 * 2)
  })

  it('un Fallo rompe el combo; el pad incorrecto no', () => {
    const notes = notesFor(6)
    const scores = manager(notes)
    // 0,1 perfectos · 2 golpe en otro pad + Fallo · 3,4,5 perfectos
    for (const j of play(notes, [0, 0, 'wrong', 0, 0, 0])) scores.apply(j)
    const snap = scores.snapshot()
    expect(snap.combo).toBe(3)
    expect(snap.bestCombo).toBe(3)
    expect(snap.counts).toEqual({ perfect: 5, close: 0, miss: 1, wrongPad: 1 })
  })

  it('el bonus de dinámica también se multiplica', () => {
    const notes = notesFor(1).map(n => ({ ...n, velocity: 30 })) // ghost
    const evaluator = new HitEvaluator(notes, { level: 'intermediate', dynamicsBonus: true })
    const scores = manager(notes)
    scores.apply({ ...evaluator.judge({ t: 0, piece: 'snare', velocity: 20 }), t: 0 })
    expect(scores.snapshot().score).toBe(100 + DYNAMIC_BONUS_POINTS)
  })
})

describe('precisión', () => {
  it('(Perfecto + Cerca) / evaluadas; sin notas = null', () => {
    expect(precisionOf({ perfect: 0, close: 0, miss: 0 })).toBeNull()
    expect(precisionOf({ perfect: 6, close: 3, miss: 1 })).toBe(0.9)
    const notes = notesFor(4)
    const scores = manager(notes)
    for (const j of play(notes, [0, 50, null, 'wrong'])) scores.apply(j)
    expect(scores.snapshot().precision).toBe(0.5) // 2 de 4; el pad incorrecto no suma evaluadas
  })
})

describe('agregados', () => {
  // 32 notas = 4 compases de corcheas: compás 1 perfecto, 2 todo fallo, 3 la mitad, 4 perfecto
  const pieces: Piece[] = ['kick', 'snare_rim', 'hihat_pedal', 'tom3']
  const notes = notesFor(32, i => pieces[i % 4])
  const offsets = notes.map((_, i) => {
    const measure = Math.floor(i / 8) + 1
    if (measure === 2) return null
    if (measure === 3 && i % 2 === 0) return null
    return 0
  })

  function results() {
    const scores = manager(notes)
    const log = play(notes, offsets)
    for (const j of log) scores.apply(j)
    return scores.results()
  }

  it('por compás, en orden y solo con notas evaluadas', () => {
    const { byMeasure } = results()
    expect(byMeasure.map(m => [m.measure, m.precision])).toEqual([
      [1, 1],
      [2, 0],
      [3, 0.5],
      [4, 1],
    ])
    expect(byMeasure[2].tally).toEqual({ perfect: 4, close: 0, miss: 4 })
  })

  it('por sección suma sus compases', () => {
    const { bySection } = results()
    expect(bySection.map(s => [s.name, s.precision])).toEqual([
      ['Intro', 0.5], // compases 1–2: 8 de 16
      ['Verso', 0.75], // compases 3–4: 12 de 16
    ])
    expect(sectionForMeasure(SECTIONS, 4)?.name).toBe('Verso')
    expect(sectionForMeasure(SECTIONS, 11)).toBeNull()
  })

  it('precisión de sección en vivo: las secciones sin notas evaluadas quedan en null', () => {
    const scores = manager(notes)
    const log = play(notes, offsets)
    // Solo la mitad de la partida: hasta el final del compás 2
    for (const j of log.filter(j => j.t < GRID.downbeats[2])) scores.apply(j)
    expect(scores.sectionStats().map(s => [s.name, s.precision])).toEqual([
      ['Intro', 0.5],
      ['Verso', null],
    ])
    for (const j of log.filter(j => j.t >= GRID.downbeats[2])) scores.apply(j)
    expect(scores.sectionStats()).toEqual(scores.results().bySection)
  })

  it('por pieza agrupada (rim → caja, pedal → hi-hat, tom3 → toms)', () => {
    const { byGroup } = results()
    expect(byGroup.snare.perfect + byGroup.snare.miss).toBe(8)
    expect(byGroup.hihat.perfect + byGroup.hihat.miss).toBe(8)
    expect(byGroup.toms.perfect + byGroup.toms.miss).toBe(8)
    // en el compás 3 fallan las notas pares: bombo y pedal
    expect(byGroup.kick.precision).toBe(0.5)
    expect(byGroup.snare.precision).toBe(0.75)
    expect(byGroup.cymbals).toEqual({ perfect: 0, close: 0, miss: 0, precision: null })
  })

  it('mejor combo y dónde ocurrió', () => {
    const { bestComboRun } = results()
    // última nota del compás 3 + todo el compás 4: 9 seguidos (el compás 1 queda en 8)
    expect(bestComboRun).toEqual({
      count: 9,
      startT: 23 * 0.25,
      endT: 31 * 0.25,
      startMeasure: 3,
      endMeasure: 4,
    })
  })
})

describe('tendencia de timing', () => {
  it(`promedia los últimos ${TIMING_TREND_HITS} aciertos; la media global, todos`, () => {
    const notes = notesFor(TIMING_TREND_HITS + 4)
    // 4 golpes 40 ms temprano y luego 16 golpes 10 ms tarde
    const offsets = notes.map((_, i) => (i < 4 ? -40 : 10))
    const scores = manager(notes)
    const evaluator = new HitEvaluator(notes, { level: 'beginner' })
    notes.forEach((n, i) =>
      scores.apply({
        ...evaluator.judge({ t: n.t + offsets[i] / 1000, piece: n.piece, velocity: 80 }),
        t: n.t,
      }),
    )
    expect(scores.snapshot().timingTrendMs).toBeCloseTo(10, 6)
    expect(scores.results().meanDeltaMs).toBeCloseTo((4 * -40 + 16 * 10) / 20, 6)
    expect(manager(notes).snapshot().timingTrendMs).toBeNull()
  })
})

describe('rebuild', () => {
  it('da el mismo estado que aplicar los juicios uno a uno', () => {
    const notes = notesFor(30)
    const log = play(notes, [0, 50, null, 'wrong', -20])
    const live = manager(notes)
    for (const j of log) live.apply(j)
    const rebuilt = manager(notes)
    rebuilt.apply(log[0])
    rebuilt.rebuild(log)
    expect(rebuilt.results()).toEqual(live.results())
    rebuilt.rebuild([])
    expect(rebuilt.snapshot()).toMatchObject({ score: 0, combo: 0, bestCombo: 0, precision: null })
  })
})

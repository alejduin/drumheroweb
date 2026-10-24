import { describe, expect, it } from 'vitest'
import {
  classifyAccuracy,
  evaluateHit,
  findClosestNote,
  isNoteMissed,
} from '@/engine/legacy/HitEvaluatorV1'
import { GOOD_WINDOW_MS, GREAT_WINDOW_MS, PERFECT_WINDOW_MS, POINTS } from '@/constants/game'
import { HitAccuracy } from '@/types'
import type { NoteEvent } from '@/types'

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeNote(absoluteTimeMs: number, instrument: NoteEvent['instrument'] = 'kick'): NoteEvent {
  return { beat: 1, subdivision: 0, instrument, midi: 36, absoluteTimeMs }
}

// ─── classifyAccuracy ─────────────────────────────────────────────────────────

describe('classifyAccuracy', () => {
  it('delta 0 → Perfect', () => {
    expect(classifyAccuracy(0)).toBe(HitAccuracy.Perfect)
  })

  it(`delta exactamente ±${PERFECT_WINDOW_MS}ms → Perfect (límite incluido)`, () => {
    expect(classifyAccuracy(PERFECT_WINDOW_MS)).toBe(HitAccuracy.Perfect)
    expect(classifyAccuracy(-PERFECT_WINDOW_MS)).toBe(HitAccuracy.Perfect)
  })

  it(`delta ${PERFECT_WINDOW_MS + 1}ms → Great`, () => {
    expect(classifyAccuracy(PERFECT_WINDOW_MS + 1)).toBe(HitAccuracy.Great)
    expect(classifyAccuracy(-(PERFECT_WINDOW_MS + 1))).toBe(HitAccuracy.Great)
  })

  it(`delta exactamente ±${GREAT_WINDOW_MS}ms → Great (límite incluido)`, () => {
    expect(classifyAccuracy(GREAT_WINDOW_MS)).toBe(HitAccuracy.Great)
    expect(classifyAccuracy(-GREAT_WINDOW_MS)).toBe(HitAccuracy.Great)
  })

  it(`delta ${GREAT_WINDOW_MS + 1}ms → Good`, () => {
    expect(classifyAccuracy(GREAT_WINDOW_MS + 1)).toBe(HitAccuracy.Good)
  })

  it(`delta exactamente ±${GOOD_WINDOW_MS}ms → Good (límite incluido)`, () => {
    expect(classifyAccuracy(GOOD_WINDOW_MS)).toBe(HitAccuracy.Good)
    expect(classifyAccuracy(-GOOD_WINDOW_MS)).toBe(HitAccuracy.Good)
  })

  it(`delta ${GOOD_WINDOW_MS + 1}ms → Miss`, () => {
    expect(classifyAccuracy(GOOD_WINDOW_MS + 1)).toBe(HitAccuracy.Miss)
    expect(classifyAccuracy(-(GOOD_WINDOW_MS + 1))).toBe(HitAccuracy.Miss)
  })

  it('delta muy grande → Miss', () => {
    expect(classifyAccuracy(500)).toBe(HitAccuracy.Miss)
    expect(classifyAccuracy(-500)).toBe(HitAccuracy.Miss)
  })
})

// ─── evaluateHit ──────────────────────────────────────────────────────────────

describe('evaluateHit', () => {
  it('hit perfecto (mismo tiempo que la nota)', () => {
    const note = makeNote(1000)
    const result = evaluateHit(1000, note)

    expect(result.accuracy).toBe(HitAccuracy.Perfect)
    expect(result.deltaMs).toBe(0)
    expect(result.points).toBe(POINTS.perfect)
    expect(result.noteEvent).toBe(note)
  })

  it('hit un poco tarde → Great', () => {
    const note = makeNote(1000)
    const result = evaluateHit(1050, note) // 50ms tarde
    expect(result.accuracy).toBe(HitAccuracy.Great)
    expect(result.deltaMs).toBe(50)
  })

  it('hit un poco temprano → Good', () => {
    const note = makeNote(1000)
    const result = evaluateHit(920, note) // 80ms temprano > GREAT_WINDOW (60ms)
    expect(result.accuracy).toBe(HitAccuracy.Good)
    expect(result.deltaMs).toBe(-80)
  })

  it('hit muy tarde → Miss con puntos 0', () => {
    const note = makeNote(1000)
    const result = evaluateHit(1200, note) // 200ms tarde
    expect(result.accuracy).toBe(HitAccuracy.Miss)
    expect(result.points).toBe(0)
  })

  it('aplica compensación de latencia positiva (usuario llega tarde sistemáticamente)', () => {
    const note = makeNote(1000)
    // Sin offset: hit a 1020ms → delta +20ms → Perfect
    // Con offset +20ms: adjustedHit = 1020 - 20 = 1000 → delta 0 → Perfect
    const result = evaluateHit(1020, note, 20)
    expect(result.accuracy).toBe(HitAccuracy.Perfect)
    expect(result.deltaMs).toBe(0)
  })

  it('aplica compensación de latencia negativa', () => {
    const note = makeNote(1000)
    // Hit a 980ms, offset -20ms: adjustedHit = 980 - (-20) = 1000 → delta 0
    const result = evaluateHit(980, note, -20)
    expect(result.accuracy).toBe(HitAccuracy.Perfect)
    expect(result.deltaMs).toBe(0)
  })

  it('deltaMs positivo = llegó tarde', () => {
    const note = makeNote(1000)
    const result = evaluateHit(1040, note)
    expect(result.deltaMs).toBeGreaterThan(0)
  })

  it('deltaMs negativo = llegó temprano', () => {
    const note = makeNote(1000)
    const result = evaluateHit(960, note)
    expect(result.deltaMs).toBeLessThan(0)
  })
})

// ─── isNoteMissed ─────────────────────────────────────────────────────────────

describe('isNoteMissed', () => {
  it('nota dentro de la ventana → no missada', () => {
    expect(isNoteMissed(1000, 1050)).toBe(false) // 50ms después → aún en ventana
  })

  it(`nota exactamente en el límite (${GOOD_WINDOW_MS}ms) → no missada`, () => {
    expect(isNoteMissed(1000, 1000 + GOOD_WINDOW_MS)).toBe(false)
  })

  it(`nota ${GOOD_WINDOW_MS + 1}ms después → missada`, () => {
    expect(isNoteMissed(1000, 1000 + GOOD_WINDOW_MS + 1)).toBe(true)
  })

  it('nota muy en el pasado → missada', () => {
    expect(isNoteMissed(500, 2000)).toBe(true)
  })
})

// ─── findClosestNote ──────────────────────────────────────────────────────────

describe('findClosestNote', () => {
  it('encuentra la nota más cercana del instrumento correcto', () => {
    const notes = [makeNote(1000, 'kick'), makeNote(1010, 'kick'), makeNote(1005, 'snare')]

    const result = findClosestNote(1008, 'kick', notes)
    expect(result).toBe(notes[1]) // 1010 está más cerca de 1008 que 1000
  })

  it('ignora notas de otros instrumentos', () => {
    const notes = [makeNote(1000, 'snare'), makeNote(1002, 'crash')]
    expect(findClosestNote(1001, 'kick', notes)).toBeNull()
  })

  it('retorna null si no hay notas en la ventana Good', () => {
    const notes = [makeNote(1000, 'kick')]
    // Hit a 1200ms → delta 200ms > GOOD_WINDOW_MS (100ms)
    expect(findClosestNote(1200, 'kick', notes)).toBeNull()
  })

  it('retorna null para lista vacía', () => {
    expect(findClosestNote(1000, 'kick', [])).toBeNull()
  })

  it('funciona con una sola nota exacta', () => {
    const note = makeNote(1000, 'snare')
    expect(findClosestNote(1000, 'snare', [note])).toBe(note)
  })

  it('respeta el límite de la ventana exactamente', () => {
    const note = makeNote(1000, 'kick')
    // Hit exactamente en el límite → debe encontrarla
    expect(findClosestNote(1000 + GOOD_WINDOW_MS, 'kick', [note])).toBe(note)
    // Un ms más allá → no debe encontrarla
    expect(findClosestNote(1000 + GOOD_WINDOW_MS + 1, 'kick', [note])).toBeNull()
  })
})

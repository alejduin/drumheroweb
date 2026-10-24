import { describe, expect, it } from 'vitest'
import { LEVELS } from '@/types'
import type { ChartNote, Level, Piece, PlayedHit } from '@/types'
import { DYNAMIC_BONUS_POINTS, LEVEL_WINDOWS } from '@/constants/scoring'
import { HitEvaluator, classifyDelta, timingOf } from '@/engine/HitEvaluator'

const note = (t: number, piece: Piece = 'snare', over: Partial<ChartNote> = {}): ChartNote => ({
  t,
  piece,
  velocity: 80,
  confidence: 0.9,
  ...over,
})

const hit = (t: number, piece: Piece = 'snare', velocity = 80): PlayedHit => ({
  t,
  piece,
  velocity,
})

/** Golpe a `deltaMs` de una nota en t = 10 s (sumado en segundos, como llega del reloj). */
function judgeAt(level: Level, deltaMs: number) {
  const evaluator = new HitEvaluator([note(10)], { level })
  return evaluator.judge(hit(10 + deltaMs / 1000))
}

// ─── Límites por nivel ────────────────────────────────────────────────────────

// [nivel, |delta| ms, juicio esperado]; los límites son inclusivos
const BOUNDARIES: Array<[Level, number, string]> = [
  ['expert', 20, 'perfect'],
  ['expert', 21, 'close'],
  ['expert', 50, 'close'],
  ['expert', 51, 'wrong_pad'],
  ['intermediate', 30, 'perfect'],
  ['intermediate', 31, 'close'],
  ['intermediate', 50, 'close'],
  ['intermediate', 80, 'close'],
  ['intermediate', 81, 'wrong_pad'],
  ['beginner', 20, 'perfect'],
  ['beginner', 45, 'perfect'],
  ['beginner', 46, 'close'],
  ['beginner', 80, 'close'],
  ['beginner', 110, 'close'],
  ['beginner', 111, 'wrong_pad'],
]

describe('ventanas por nivel', () => {
  it.each(BOUNDARIES)('%s: ±%i ms → %s', (level, ms, expected) => {
    expect(judgeAt(level, ms).judgement).toBe(expected)
    expect(judgeAt(level, -ms).judgement).toBe(expected)
  })

  it('classifyDelta usa las ventanas de la tabla', () => {
    for (const level of LEVELS) {
      const w = LEVEL_WINDOWS[level]
      expect(classifyDelta(w.perfectMs, w)).toBe('perfect')
      expect(classifyDelta(-w.closeMs, w)).toBe('close')
      expect(classifyDelta(w.closeMs + 0.01, w)).toBeNull()
    }
  })

  it('puntos por nivel: Experto Cerca = 40, el resto 50', () => {
    expect(judgeAt('expert', 0)).toMatchObject({ judgement: 'perfect', points: 100 })
    expect(judgeAt('expert', 30)).toMatchObject({ judgement: 'close', points: 40 })
    expect(judgeAt('intermediate', 60)).toMatchObject({ points: 50 })
    expect(judgeAt('beginner', -100)).toMatchObject({ points: 50 })
  })
})

describe('temprano / tarde', () => {
  it('el signo del delta indica temprano (< 0) o tarde (> 0)', () => {
    expect(judgeAt('intermediate', -40)).toMatchObject({ timing: 'early' })
    expect(judgeAt('intermediate', 40)).toMatchObject({ timing: 'late' })
    const early = judgeAt('intermediate', -40)
    expect(early.judgement === 'close' && early.deltaMs).toBeCloseTo(-40, 6)
    expect(timingOf(0)).toBe('on_time')
  })

  it('resta la latencia del kit antes de evaluar', () => {
    // El kit llega 25 ms tarde: un golpe registrado a +25 ms es exacto
    const evaluator = new HitEvaluator([note(10)], { level: 'expert', latencyMs: 25 })
    const result = evaluator.judge(hit(10.025))
    expect(result).toMatchObject({ judgement: 'perfect', timing: 'on_time' })
  })
})

// ─── Selección de la nota ─────────────────────────────────────────────────────

describe('selección de la nota candidata', () => {
  it('elige la nota pendiente más cercana de la misma pieza', () => {
    const notes = [note(1.0), note(1.06), note(1.0, 'kick')]
    const evaluator = new HitEvaluator(notes, { level: 'beginner' })
    expect(evaluator.judge(hit(1.04))).toMatchObject({ noteIndex: 1, judgement: 'perfect' })
    // la de 1.06 ya está tomada: el siguiente golpe cerca va a la de 1.0
    expect(evaluator.judge(hit(1.04))).toMatchObject({ noteIndex: 0, judgement: 'perfect' })
  })

  it('una nota no se acierta dos veces', () => {
    const evaluator = new HitEvaluator([note(1)], { level: 'beginner' })
    expect(evaluator.judge(hit(1)).judgement).toBe('perfect')
    expect(evaluator.judge(hit(1.01))).toMatchObject({
      judgement: 'wrong_pad',
      expectedPiece: null,
    })
  })

  it('a igual distancia gana la nota anterior', () => {
    const evaluator = new HitEvaluator([note(1.0), note(1.1)], { level: 'beginner' })
    expect(evaluator.judge(hit(1.05))).toMatchObject({ noteIndex: 0 })
  })

  it('notas simultáneas de distintas piezas se aciertan por separado', () => {
    const notes = [note(2, 'kick'), note(2, 'hihat_closed')]
    const evaluator = new HitEvaluator(notes, { level: 'expert' })
    expect(evaluator.judge(hit(2.005, 'hihat_closed'))).toMatchObject({ noteIndex: 1 })
    expect(evaluator.judge(hit(1.995, 'kick'))).toMatchObject({ noteIndex: 0 })
  })

  it('el hi-hat de pie es una pieza que cuenta', () => {
    const notes = [note(3, 'hihat_pedal'), note(3, 'hihat_closed')]
    const evaluator = new HitEvaluator(notes, { level: 'intermediate' })
    expect(evaluator.judge(hit(3, 'hihat_pedal'))).toMatchObject({
      judgement: 'perfect',
      piece: 'hihat_pedal',
    })
  })
})

describe('pad incorrecto', () => {
  it('pieza equivocada: gris, informa la pieza esperada y no consume la nota', () => {
    const evaluator = new HitEvaluator([note(5, 'snare')], { level: 'intermediate' })
    expect(evaluator.judge(hit(5.01, 'tom1'))).toEqual({
      judgement: 'wrong_pad',
      piece: 'tom1',
      expectedPiece: 'snare',
      velocity: 80,
    })
    expect(evaluator.isPending(0)).toBe(true)
    expect(evaluator.judge(hit(5.04, 'snare')).judgement).toBe('close')
  })

  it('hi-hat abierto y cerrado son pads distintos', () => {
    const evaluator = new HitEvaluator([note(1, 'hihat_closed')], { level: 'beginner' })
    expect(evaluator.judge(hit(1, 'hihat_open'))).toMatchObject({
      judgement: 'wrong_pad',
      expectedPiece: 'hihat_closed',
    })
  })

  it('golpe sin ninguna nota cerca: gris sin pieza esperada', () => {
    const evaluator = new HitEvaluator([note(5)], { level: 'expert' })
    expect(evaluator.judge(hit(8, 'kick'))).toMatchObject({ expectedPiece: null })
    expect(new HitEvaluator([], { level: 'expert' }).judge(hit(1)).judgement).toBe('wrong_pad')
  })
})

// ─── Dinámica ─────────────────────────────────────────────────────────────────

describe('bonus de dinámica', () => {
  const notes = [
    note(1, 'snare', { velocity: 35 }), // ghost (derivada de velocity)
    note(2, 'snare', { velocity: 80, dynamic: 'accent' }), // acento explícito
    note(3, 'snare', { velocity: 80 }), // normal
  ]

  it('+10 al tocar suave una ghost o fuerte un acento', () => {
    const evaluator = new HitEvaluator(notes, { level: 'intermediate', dynamicsBonus: true })
    expect(evaluator.judge(hit(1, 'snare', 40))).toMatchObject({
      dynamicBonus: DYNAMIC_BONUS_POINTS,
    })
    expect(evaluator.judge(hit(2, 'snare', 110))).toMatchObject({
      dynamicBonus: DYNAMIC_BONUS_POINTS,
    })
    expect(evaluator.judge(hit(3, 'snare', 127))).toMatchObject({ dynamicBonus: 0 })
  })

  it('sin bonus si no se respeta la dinámica, en el límite o con la opción apagada', () => {
    const on = new HitEvaluator(notes, { level: 'intermediate', dynamicsBonus: true })
    expect(on.judge(hit(1, 'snare', 50))).toMatchObject({ dynamicBonus: 0 })
    expect(on.judge(hit(2, 'snare', 100))).toMatchObject({ dynamicBonus: 0 })
    const off = new HitEvaluator(notes, { level: 'intermediate' })
    expect(off.judge(hit(1, 'snare', 20))).toMatchObject({ dynamicBonus: 0 })
  })
})

// ─── Fallos y seek ────────────────────────────────────────────────────────────

describe('expire', () => {
  it('la nota es Fallo cuando cierra su ventana Cerca (límite inclusivo)', () => {
    const evaluator = new HitEvaluator([note(1), note(2, 'kick')], { level: 'intermediate' })
    expect(evaluator.expire(1.08)).toEqual([]) // justo en +80 ms aún se puede golpear
    expect(evaluator.expire(1.0801)).toEqual([{ judgement: 'miss', noteIndex: 0, piece: 'snare' }])
    expect(evaluator.expire(1.5)).toEqual([]) // no se repite
    expect(evaluator.expire(10).map(m => m.noteIndex)).toEqual([1])
  })

  it('no marca Fallo una nota ya acertada', () => {
    const evaluator = new HitEvaluator([note(1)], { level: 'intermediate' })
    evaluator.judge(hit(1.02))
    expect(evaluator.expire(5)).toEqual([])
  })

  it('con latencia, la ventana se cierra latencia más tarde en el reloj', () => {
    const evaluator = new HitEvaluator([note(1)], { level: 'expert', latencyMs: 30 })
    expect(evaluator.expire(1.079)).toEqual([])
    expect(evaluator.expire(1.081)).toHaveLength(1)
  })
})

describe('seek', () => {
  it('salta las notas anteriores y reactiva las posteriores', () => {
    const notes = [note(1), note(2), note(3)]
    const evaluator = new HitEvaluator(notes, { level: 'beginner' })
    evaluator.judge(hit(2))
    evaluator.expire(10)
    evaluator.seek(1.5)
    expect([0, 1, 2].map(i => evaluator.isPending(i))).toEqual([false, true, true])
    expect(evaluator.judge(hit(1, 'snare')).judgement).toBe('wrong_pad') // la de 1 s se saltó
    expect(evaluator.expire(10).map(m => m.noteIndex)).toEqual([1, 2])
  })
})

// ─── Rendimiento ──────────────────────────────────────────────────────────────

describe('rendimiento', () => {
  it('10 000 golpes sobre 2 000 notas: < 5 ms por golpe en promedio', () => {
    const pieces: Piece[] = ['kick', 'snare', 'hihat_closed', 'tom1', 'crash']
    // 2 000 notas en ~4 min (semicorcheas a 120 BPM), con acordes
    const notes = Array.from({ length: 2000 }, (_, i) =>
      note(Math.floor(i / 2) * 0.125, pieces[i % pieces.length]),
    )
    const evaluator = new HitEvaluator(notes, { level: 'beginner' })
    const hits = Array.from({ length: 10_000 }, (_, i) =>
      hit((i / 10_000) * 125 + ((i * 7919) % 40) / 1000 - 0.02, pieces[(i * 31) % pieces.length]),
    )
    const start = performance.now()
    for (const h of hits) {
      evaluator.judge(h)
      evaluator.expire(h.t)
    }
    const perHitMs = (performance.now() - start) / hits.length
    expect(perHitMs).toBeLessThan(5)
  })
})

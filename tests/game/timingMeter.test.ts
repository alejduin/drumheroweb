import { describe, expect, it } from 'vitest'
import { LEVEL_WINDOWS, TIMING_TREND_HITS } from '@/constants/scoring'
import type { TimedJudgement } from '@/engine/GameEngine'
import { meterPosition, meterTone, timingText } from '@/game/timingMeter'
import { ScoreManager } from '@/scoring/ScoreManager'

const windows = LEVEL_WINDOWS.intermediate

const hit = (noteIndex: number, deltaMs: number): TimedJudgement => ({
  judgement: Math.abs(deltaMs) <= windows.perfectMs ? 'perfect' : 'close',
  noteIndex,
  piece: 'snare',
  deltaMs,
  timing: deltaMs < 0 ? 'early' : deltaMs > 0 ? 'late' : 'on_time',
  points: 100,
  dynamicBonus: 0,
  velocity: 80,
  t: noteIndex,
})

describe('medidor de timing', () => {
  it('posición lineal entre -Cerca y +Cerca, centrada sin datos', () => {
    expect(meterPosition(null, 80)).toBe(0.5)
    expect(meterPosition(0, 80)).toBe(0.5)
    expect(meterPosition(40, 80)).toBe(0.75)
    expect(meterPosition(-80, 80)).toBe(0)
  })

  it('clamp a los extremos de la barra', () => {
    expect(meterPosition(500, 80)).toBe(1)
    expect(meterPosition(-500, 80)).toBe(0)
    expect(meterPosition(10, 0)).toBe(0.5)
  })

  it('promedia los últimos TIMING_TREND_HITS aciertos (los Fallos no cuentan)', () => {
    const count = TIMING_TREND_HITS + 4
    const notes = Array.from({ length: count + 1 }, (_, i) => ({
      t: i,
      piece: 'snare' as const,
      velocity: 80,
      confidence: 1,
    }))
    const scores = new ScoreManager({ notes, grid: { beats: [0], downbeats: [0] }, sections: [] })
    // 4 golpes muy tarde que salen de la ventana de promedio, luego 16 a +14 ms
    for (let i = 0; i < 4; i++) scores.apply(hit(i, 70))
    for (let i = 4; i < count; i++) scores.apply(hit(i, 14))
    scores.apply({ judgement: 'miss', noteIndex: count, piece: 'snare', t: count })
    const trend = scores.snapshot().timingTrendMs
    expect(trend).toBeCloseTo(14, 9)
    expect(meterPosition(trend, windows.closeMs)).toBeCloseTo(0.5875, 9)
    expect(timingText(trend)).toBe('vas +14 ms tarde en promedio')
  })

  it('texto y tono según la tendencia', () => {
    expect(timingText(null)).toBe('toca para medir tu timing')
    expect(timingText(2.4)).toBe('vas a tiempo en promedio')
    expect(timingText(-9.2)).toBe('vas -9 ms temprano en promedio')
    expect(meterTone(null, windows)).toBe('perfect')
    expect(meterTone(-3, windows)).toBe('perfect')
    expect(meterTone(14, windows)).toBe('close')
    expect(meterTone(-45, windows)).toBe('miss')
  })
})

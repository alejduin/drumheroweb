import { describe, expect, it } from 'vitest'
import type { ChartGrid } from '@/types'
import {
  beatPosition,
  measureAt,
  measureCount,
  measureRange,
  timeToMeasureBeat,
} from '@/chart/grid'

// 120 BPM constante en 4/4: un beat cada 0.5 s, compás cada 2 s
const STEADY: ChartGrid = {
  beats: Array.from({ length: 16 }, (_, i) => i * 0.5),
  downbeats: [0, 2, 4, 6],
}

// Tempo variable con anacrusa de 2 beats: los beats se separan (acelerando → frenando)
// beats:      0.0  0.6 | 1.2  1.7  2.2  2.7 | 3.2  3.9  4.6  5.3
// compás:     0    0   | 1               | 2
const DRIFT: ChartGrid = {
  beats: [0, 0.6, 1.2, 1.7, 2.2, 2.7, 3.2, 3.9, 4.6, 5.3],
  downbeats: [1.2, 3.2],
}

describe('timeToMeasureBeat', () => {
  it('a tempo constante coincide con la aritmética de BPM', () => {
    expect(timeToMeasureBeat(STEADY, 0)).toEqual({ measure: 1, beat: 1 })
    expect(timeToMeasureBeat(STEADY, 1.25).measure).toBe(1)
    expect(timeToMeasureBeat(STEADY, 1.25).beat).toBeCloseTo(3.5)
    expect(timeToMeasureBeat(STEADY, 2)).toEqual({ measure: 2, beat: 1 })
    expect(timeToMeasureBeat(STEADY, 7.75).beat).toBeCloseTo(4.5)
  })

  it('con tempo variable interpola entre los beats reales', () => {
    // A mitad entre 3.2 y 3.9 = beat 1.5 del compás 2 (no 2.0 como daría un BPM fijo)
    const mid = timeToMeasureBeat(DRIFT, 3.55)
    expect(mid.measure).toBe(2)
    expect(mid.beat).toBeCloseTo(1.5)
    const third = timeToMeasureBeat(DRIFT, 2.2)
    expect(third).toEqual({ measure: 1, beat: 3 })
  })

  it('la anacrusa es el compás 0, contada desde el primer beat', () => {
    expect(timeToMeasureBeat(DRIFT, 0.9)).toEqual({ measure: 0, beat: 2.5 })
  })

  it('después del último beat extrapola con el último intervalo', () => {
    const after = timeToMeasureBeat(DRIFT, 6.0)
    expect(after.measure).toBe(2)
    expect(after.beat).toBeCloseTo(5) // 5.3 + 0.7 = un beat más
  })

  it('tolera el redondeo a 4 decimales en los límites', () => {
    expect(measureAt(STEADY, 1.9998)).toBe(2)
    expect(measureAt(STEADY, 1.99)).toBe(1)
  })
})

describe('beatPosition', () => {
  it('con un solo beat no hay intervalos: 0', () => {
    expect(beatPosition({ beats: [1], downbeats: [1] }, 3)).toBe(0)
  })
})

describe('measureRange', () => {
  it('va de downbeat a downbeat y el último termina en durationS', () => {
    expect(measureCount(DRIFT)).toBe(2)
    expect(measureRange(DRIFT, 1, 6)).toEqual({ startS: 1.2, endS: 3.2 })
    expect(measureRange(DRIFT, 2, 6)).toEqual({ startS: 3.2, endS: 6 })
  })

  it('rechaza compases inexistentes', () => {
    expect(() => measureRange(DRIFT, 0, 6)).toThrow(RangeError)
    expect(() => measureRange(DRIFT, 3, 6)).toThrow(RangeError)
    expect(() => measureRange(DRIFT, 1.5, 6)).toThrow(RangeError)
  })
})

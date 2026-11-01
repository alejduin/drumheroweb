import { describe, expect, it } from 'vitest'
import type { ChartGrid, Judgement } from '@/types'
import type { TimedJudgement } from '@/engine/GameEngine'
import {
  clampLoop,
  countInClicks,
  countInLengthS,
  lapPrecision,
  lapText,
  waitText,
  loopAt,
  loopFromSelection,
  loopRange,
  nextRampTempo,
} from '@/game/practice'

// 120 BPM en 4/4 desde 1 s: beats cada 0,5 s, compases de 2 s; 8 compases
const GRID: ChartGrid = {
  beats: Array.from({ length: 32 }, (_, i) => 1 + i * 0.5),
  downbeats: Array.from({ length: 8 }, (_, i) => 1 + i * 2),
}
const DURATION_S = 18

const j = (judgement: Judgement): TimedJudgement =>
  ({ judgement, t: 0, noteIndex: 0, piece: 'snare' }) as unknown as TimedJudgement

describe('loop por compases', () => {
  it('loopRange va del downbeat de A al de después de B; el último compás termina en durationS', () => {
    expect(loopRange(GRID, DURATION_S, { startMeasure: 2, endMeasure: 3 })).toEqual({
      startS: 3,
      endS: 7,
    })
    expect(loopRange(GRID, DURATION_S, { startMeasure: 8, endMeasure: 8 })).toEqual({
      startS: 15,
      endS: DURATION_S,
    })
  })

  it('clampLoop ordena y limita a los compases que existen', () => {
    expect(clampLoop(GRID, { startMeasure: 6, endMeasure: 2 })).toEqual({
      startMeasure: 2,
      endMeasure: 6,
    })
    expect(clampLoop(GRID, { startMeasure: 0, endMeasure: 20 })).toEqual({
      startMeasure: 1,
      endMeasure: 8,
    })
    expect(clampLoop({ beats: [], downbeats: [] }, { startMeasure: 1, endMeasure: 2 })).toBeNull()
  })

  it('una selección sobre la onda toma los compases que toca, en cualquier sentido', () => {
    expect(loopFromSelection(GRID, 3.2, 6.9)).toEqual({ startMeasure: 2, endMeasure: 3 })
    expect(loopFromSelection(GRID, 6.9, 3.2)).toEqual({ startMeasure: 2, endMeasure: 3 })
    // Terminar justo en un downbeat no incluye el compás siguiente
    expect(loopFromSelection(GRID, 3, 7)).toEqual({ startMeasure: 2, endMeasure: 3 })
    // Antes del primer downbeat cuenta como el compás 1
    expect(loopFromSelection(GRID, 0, 2)).toEqual({ startMeasure: 1, endMeasure: 1 })
  })

  it('loopAt arma 4 compases desde el que suena, sin pasarse del final', () => {
    expect(loopAt(GRID, 5.5)).toEqual({ startMeasure: 3, endMeasure: 6 })
    expect(loopAt(GRID, 16)).toEqual({ startMeasure: 8, endMeasure: 8 })
  })
})

describe('rampa de tempo', () => {
  it('la precisión de una vuelta ignora el pad incorrecto', () => {
    expect(lapPrecision([j('perfect'), j('close'), j('miss'), j('wrong_pad')])).toBeCloseTo(2 / 3)
    expect(lapPrecision([j('wrong_pad')])).toBeNull()
    expect(lapPrecision([])).toBeNull()
  })

  it('sube 5 % al lograr ≥ 90 %, hasta 100 %', () => {
    expect(nextRampTempo(0.75, 0.9)).toBe(0.8)
    expect(nextRampTempo(0.75, 0.89)).toBe(0.75)
    expect(nextRampTempo(0.75, null)).toBe(0.75)
    expect(nextRampTempo(0.95, 1)).toBe(1)
    expect(nextRampTempo(1, 1)).toBe(1)
  })
})

describe('cuenta de un compás', () => {
  it('son los 4 beats anteriores al punto de arranque, con el primero acentuado', () => {
    const clicks = countInClicks(GRID, 5, 4)
    expect(clicks.map(c => c.t)).toEqual([3, 3.5, 4, 4.5])
    expect(clicks.map(c => c.accent)).toEqual([true, false, false, false])
    expect(countInLengthS(clicks, 5)).toBe(2)
  })

  it('al reanudar a mitad de beat, la cuenta termina en el beat anterior', () => {
    const clicks = countInClicks(GRID, 5.2, 4)
    expect(clicks.map(c => c.t)).toEqual([3.5, 4, 4.5, 5])
    expect(countInLengthS(clicks, 5.2)).toBeCloseTo(1.7)
  })

  it('antes de la rejilla se extrapola con el primer intervalo (tiempos negativos)', () => {
    const clicks = countInClicks(GRID, 1, 4)
    expect(clicks.map(c => c.t)).toEqual([-1, -0.5, 0, 0.5])
    expect(countInLengthS(clicks, 1)).toBe(2)
    // Todos los clicks quedan antes del arranque
    expect(countInClicks(GRID, 0, 3).map(c => c.t)).toEqual([-1.5, -1, -0.5])
  })

  it('sin rejilla no hay cuenta', () => {
    expect(countInClicks({ beats: [1], downbeats: [1] }, 2, 4)).toEqual([])
    expect(countInLengthS([], 2)).toBe(0)
  })
})

describe('lapText', () => {
  const loop = { startMeasure: 12, endMeasure: 15 }
  it('explica qué hace la rampa según el loop y la última vuelta', () => {
    expect(lapText(null, null, true)).toMatch(/loop A–B/)
    expect(lapText(loop, null, true)).toBe(
      'Loop en compases 12–15: al terminar cada vuelta verás su precisión',
    )
    expect(lapText(loop, { lap: 3, precision: 0.92, tempo: 0.75, nextTempo: 0.8 }, true)).toBe(
      'Vuelta 3: 92 % → sube a 80 %',
    )
    expect(lapText(loop, { lap: 4, precision: 0.8, tempo: 0.8, nextTempo: 0.8 }, true)).toBe(
      'Vuelta 4: 80 % · con 90 % sube el tempo',
    )
    expect(lapText(loop, { lap: 1, precision: null, tempo: 1, nextTempo: 1 }, false)).toBe(
      'Vuelta 1: sin notas',
    )
  })
})

describe('waitText', () => {
  it('explica el modo o dice qué falta tocar', () => {
    expect(waitText(null)).toMatch(/hasta que la toques/)
    expect(waitText(['snare', 'kick'])).toBe('Esperando: Caja + Bombo')
  })
})

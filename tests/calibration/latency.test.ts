import { describe, expect, it } from 'vitest'
import {
  CALIBRATION_HITS,
  CALIBRATION_INTERVAL_S,
  CONSISTENT_SPREAD_MS,
  COUNT_IN_BEATS,
  FIRST_CLICK_S,
  MAX_HIT_DISTANCE_MS,
  MIN_LATENCY_SAMPLES,
  calibrationGrid,
  computeLatency,
  isConsistent,
  nearestClick,
} from '@/calibration/latency'

describe('computeLatency', () => {
  it('descarta la peor muestra y promedia el resto', () => {
    const result = computeLatency([20, 22, 18, 21, 19, 20, 80, 20])
    expect(result).not.toBeNull()
    expect(result!.discarded).toBe(80)
    expect(result!.used).toEqual([20, 22, 18, 21, 19, 20, 20])
    expect(result!.latencyMs).toBe(20)
    expect(result!.spreadMs).toBe(4)
  })

  it('el outlier se mide contra la mediana, no contra el promedio (también temprano)', () => {
    const result = computeLatency([10, 12, 11, -60, 9, 10, 11, 12])
    expect(result!.discarded).toBe(-60)
    expect(result!.latencyMs).toBe(11)
  })

  it('descarta siempre una aunque todas sean buenas', () => {
    const result = computeLatency([30, 30, 30, 30, 30, 30, 30, 31])
    expect(result!.used).toHaveLength(7)
    expect(result!.discarded).toBe(31)
    expect(result!.latencyMs).toBe(30)
  })

  it('redondea al ms y no devuelve -0', () => {
    // sin el primero (empate con la mediana 1,5): 8 / 5 = 1,6 → 2
    expect(computeLatency([1, 2, 1, 2, 1, 2])!.latencyMs).toBe(2)
    const zero = computeLatency([-0.2, 0.1, -0.1, 0.2, 0, 0])!
    expect(Object.is(zero.latencyMs, -0)).toBe(false)
  })

  it('latencia negativa (golpes adelantados)', () => {
    expect(computeLatency([-15, -14, -16, -15, -15, -15])!.latencyMs).toBe(-15)
  })

  it(`null con menos de ${MIN_LATENCY_SAMPLES} muestras válidas`, () => {
    expect(computeLatency([])).toBeNull()
    expect(computeLatency([10, 10, 10, 10])).toBeNull()
    expect(computeLatency([10, 10, 10, 10, NaN, Infinity])).toBeNull()
    expect(computeLatency([10, 10, 10, 10, 10])).not.toBeNull()
  })

  it('isConsistent según la dispersión de las usadas', () => {
    expect(isConsistent(computeLatency([20, 22, 18, 21, 19, 20, 80, 20])!)).toBe(true)
    const irregular = computeLatency([0, 10, 20, 30, 40, 50, 60])!
    expect(irregular.spreadMs).toBeGreaterThan(CONSISTENT_SPREAD_MS)
    expect(isConsistent(irregular)).toBe(false)
  })
})

describe('calibrationGrid', () => {
  it('entrada + clicks medidos, regulares y con acento cada 4', () => {
    const grid = calibrationGrid()
    expect(grid.beats).toHaveLength(COUNT_IN_BEATS + CALIBRATION_HITS)
    expect(grid.beats[0]).toBe(FIRST_CLICK_S)
    expect(grid.beats[1] - grid.beats[0]).toBeCloseTo(CALIBRATION_INTERVAL_S)
    expect(grid.downbeats).toEqual([grid.beats[0], grid.beats[4], grid.beats[8]])
  })
})

describe('nearestClick', () => {
  const grid = calibrationGrid()
  const measured = (k: number) => grid.beats[COUNT_IN_BEATS + k]

  it('asigna el golpe al click medido más cercano', () => {
    expect(nearestClick(grid, measured(0))).toBe(0)
    expect(nearestClick(grid, measured(3) + 0.04)).toBe(3)
    expect(nearestClick(grid, measured(7) - 0.1)).toBe(7)
  })

  it('ignora la entrada, lo que queda lejos y lo que está fuera de la pista', () => {
    expect(nearestClick(grid, grid.beats[0])).toBeNull()
    expect(nearestClick(grid, grid.beats[COUNT_IN_BEATS - 1])).toBeNull()
    expect(nearestClick(grid, measured(2) + (MAX_HIT_DISTANCE_MS + 1) / 1000)).toBeNull()
    expect(nearestClick(grid, measured(2) - MAX_HIT_DISTANCE_MS / 1000 + 0.001)).toBe(2)
    expect(nearestClick(grid, measured(7) + 0.3)).toBeNull()
    expect(nearestClick(grid, -1)).toBeNull()
  })
})

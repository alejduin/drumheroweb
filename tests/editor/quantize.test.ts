import { describe, expect, it } from 'vitest'
import type { ChartGrid } from '@/types'
import { snapTime, timeAtBeatPosition } from '@/editor/quantize'

// 120 BPM: un beat cada 0,5 s; el segundo compás se acelera (beats de 0,4 s)
const GRID: ChartGrid = {
  beats: [0, 0.5, 1, 1.5, 2, 2.4, 2.8, 3.2, 3.6],
  downbeats: [0, 2],
}

describe('cuantización del editor', () => {
  it('timeAtBeatPosition es la inversa de la posición en beats', () => {
    expect(timeAtBeatPosition(GRID, 1.5)).toBe(0.75)
    expect(timeAtBeatPosition(GRID, 4.5)).toBeCloseTo(2.2)
    // Fuera de la rejilla extrapola con el último intervalo
    expect(timeAtBeatPosition(GRID, 9)).toBeCloseTo(4)
  })

  it('ajusta a la semicorchea más cercana siguiendo el tempo real', () => {
    expect(snapTime(GRID, 0.13, 4, 10)).toBe(0.125)
    expect(snapTime(GRID, 2.11, 4, 10)).toBe(2.1)
  })

  it('tresillos y corcheas', () => {
    expect(snapTime(GRID, 0.17, 3, 10)).toBe(0.1667)
    expect(snapTime(GRID, 0.2, 2, 10)).toBe(0.25)
  })

  it('mueve casillas y nunca sale de la canción', () => {
    expect(snapTime(GRID, 0.5, 4, 10, 2)).toBe(0.75)
    expect(snapTime(GRID, 0, 4, 10, -1)).toBe(0)
    expect(snapTime(GRID, 3.6, 4, 3.7, 4)).toBe(3.7)
  })
})

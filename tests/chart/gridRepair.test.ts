import { describe, expect, it } from 'vitest'
import type { ChartGrid, ChartV2 } from '@/types'
import { repairChartGrid, repairGrid } from '@/chart/gridRepair'
import { validateChartInvariants } from '@/chart/invariants'
import { measureRange } from '@/chart/grid'

const range = (from: number, step: number, n: number) =>
  Array.from({ length: n }, (_, i) => Math.round((from + i * step) * 1e4) / 1e4)

// Arranque real de "Sonne" (beat_this): intro con beats a destiempo y dos downbeats
// a 0.12 s (compases 1 y 2 aplastados); desde ~2.6 s, pulso de 0.4 s y compás de 4 beats.
const SONNE: ChartGrid = {
  beats: [0.12, 0.28, 0.52, 0.66, 0.94, 1.06, 1.34, 1.44, 1.78, 2.62, ...range(3.42, 0.4, 20)],
  downbeats: [0.94, 1.06, 2.62, 4.22, 5.82, 7.42, 9.02],
}

function chartWith(grid: ChartGrid, sections: ChartV2['sections'] = []): ChartV2 {
  return {
    version: 2,
    id: 'x',
    title: 'x',
    artist: 'x',
    bpm: 150,
    timeSignature: [4, 4],
    durationS: 30,
    audioUrl: null,
    stems: null,
    audioSha256: null,
    youtubeUrl: null,
    youtubeOffsetMs: 0,
    grid,
    difficulties: { basic: { notes: [] }, intermediate: { notes: [] }, full: { notes: [] } },
    sections,
    source: { kind: 'ai', createdAt: '2026-01-01T00:00:00Z' },
  }
}

describe('repairGrid', () => {
  it('descarta la intro irregular y la rellena con el pulso estable', () => {
    const grid = repairGrid(SONNE)!
    // Pulso de 0.4 s hacia atrás desde 3.42 hasta 0 s
    expect(grid.beats.slice(0, 9)).toEqual([0.22, 0.62, 1.02, 1.42, 1.82, 2.22, 2.62, 3.02, 3.42])
    // Compases completos de 4 beats: 1.02 y 2.62 entran como compases enteros
    expect(grid.downbeats.slice(0, 4)).toEqual([1.02, 2.62, 4.22, 5.82])
    // El primer compás dura lo mismo que los demás
    const first = measureRange(grid, 1, 30)
    expect(first.endS - first.startS).toBeCloseTo(1.6)
  })

  it('quita beats duplicados y deja el que sigue el pulso', () => {
    // Pulso de 0.7 s; en 2.1 y 3.5 hay un beat fantasma 0.08 s antes del bueno
    const beats = [0, 0.7, 1.4, 2.02, 2.1, 2.8, 3.42, 3.5, 4.2, 4.9, 5.6, 6.3, 7.0]
    const grid = repairGrid({ beats, downbeats: [0, 2.8, 5.6] })!
    expect(grid.beats).toEqual([0, 0.7, 1.4, 2.1, 2.8, 3.5, 4.2, 4.9, 5.6, 6.3, 7.0])
    expect(grid.downbeats).toEqual([0, 2.8, 5.6])
  })

  it('mueve al beat bueno el downbeat que caía en un duplicado', () => {
    const beats = [0, 0.7, 1.4, 2.1, 2.72, 2.8, 3.5, 4.2, 4.9, 5.6, 6.3]
    const grid = repairGrid({ beats, downbeats: [0, 2.72, 2.8, 5.6] })!
    expect(grid.downbeats).toEqual([0, 2.8, 5.6])
  })

  it('quita el downbeat de un compás de menos de medio compás', () => {
    const beats = range(0, 0.5, 24)
    const grid = repairGrid({ beats, downbeats: [0, 2, 2.5, 4.5, 6.5, 8.5] })!
    expect(grid.downbeats).toEqual([0, 2, 4.5, 6.5, 8.5])
  })

  it('rehace una zona con dos series de beats desfasadas', () => {
    // Caso real de "Sonne" (12–16 s): pulso de 0.4 s; entre 13.42 y 15.42 hay dos
    // series mezcladas (14.04/14.44/14.82 y 14.22/14.62/15.02) y falta 13.82
    const beats = [
      ...range(9.02, 0.4, 8),
      12.22,
      12.42,
      12.62,
      13.02,
      13.22,
      13.42,
      13.64,
      14.04,
      14.22,
      14.44,
      14.62,
      14.82,
      15.02,
      ...range(15.42, 0.4, 12),
    ]
    const downbeats = [9.02, 10.62, 12.22, 12.42, 13.64, 14.04, 15.42, 17.02, 18.62]
    const grid = repairGrid({ beats, downbeats })!
    expect(grid.beats.filter(b => b > 12 && b < 15.5)).toEqual([
      12.22, 12.62, 13.02, 13.42, 13.82, 14.22, 14.62, 15.02, 15.42,
    ])
    expect(grid.downbeats).toEqual([9.02, 10.62, 12.22, 13.82, 15.42, 17.02, 18.62])
  })

  it('rellena un beat que falta entre dos tramos estables', () => {
    const beats = [...range(0, 0.7, 8), ...range(6.3, 0.7, 8)] // falta 5.6
    const grid = repairGrid({ beats, downbeats: [0, 2.8, 8.4] })!
    expect(grid.beats).toEqual(range(0, 0.7, 17))
  })

  it('no toca una rejilla regular', () => {
    expect(repairGrid({ beats: range(2, 0.5, 16), downbeats: [2, 4, 6, 8] })).toBeNull()
  })

  it('no toca rejillas cortas', () => {
    expect(repairGrid({ beats: [0, 0.5, 1], downbeats: [0] })).toBeNull()
  })
})

describe('repairChartGrid', () => {
  it('el chart reparado cumple las invariantes', () => {
    expect(validateChartInvariants(repairChartGrid(chartWith(SONNE)))).toEqual([])
  })

  it('las secciones siguen empezando en el mismo segundo', () => {
    // Compases viejos 4–5 = 4.22–7.42 s; en la rejilla nueva son 3–4
    const chart = repairChartGrid(
      chartWith(SONNE, [{ name: 'Verso', startMeasure: 4, endMeasure: 5 }]),
    )
    expect(chart.sections).toEqual([{ name: 'Verso', startMeasure: 3, endMeasure: 4 }])
  })

  it('devuelve el mismo chart si la rejilla está bien', () => {
    const chart = chartWith({ beats: range(0, 0.5, 16), downbeats: [0, 2, 4, 6] })
    expect(repairChartGrid(chart)).toBe(chart)
  })
})

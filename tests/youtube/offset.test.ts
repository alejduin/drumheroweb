import { describe, expect, it } from 'vitest'
import type { ChartV2 } from '@/types'
import { TAP_OUTLIER_MS, estimateOffset, kickTimes, previewStartS } from '@/youtube/offset'
import { analyzedChart } from '../fakes/FakeWorkerClient'

// Bombos cada medio segundo desde el segundo 2
const KICKS = Array.from({ length: 16 }, (_, i) => 2 + i * 0.5)

describe('estimateOffset', () => {
  it('video con 1,24 s de intro: toques exactos dan +1240 ms', () => {
    const taps = KICKS.slice(0, 6).map(k => k + 1.24)
    expect(estimateOffset(taps, KICKS)).toEqual({
      offsetMs: 1240,
      used: 6,
      discarded: 0,
      spreadMs: 0,
    })
  })

  it('promedia los errores de cada toque', () => {
    const errorsMs = [20, -10, 15, -25, 0]
    const taps = errorsMs.map((e, i) => KICKS[i] + 0.3 + e / 1000)
    const result = estimateOffset(taps, KICKS)!
    expect(result.offsetMs).toBe(300)
    expect(result.spreadMs).toBeGreaterThan(0)
  })

  it('descarta un toque atípico', () => {
    const taps = [0, 1, 2, 3, 4].map(i => KICKS[i] + 0.3)
    taps.push(KICKS[5] + 0.3 + (TAP_OUTLIER_MS + 100) / 1000)
    const result = estimateOffset(taps, KICKS)!
    expect(result.offsetMs).toBe(300)
    expect(result).toMatchObject({ used: 5, discarded: 1 })
  })

  it('un bombo saltado no rompe el emparejamiento', () => {
    // Toca el 1.º, 2.º y luego el 4.º y 5.º
    const taps = [0, 1, 3, 4].map(i => KICKS[i] - 0.5)
    expect(estimateOffset(taps, KICKS)?.offsetMs).toBe(-500)
  })

  it('el orden de los toques no importa', () => {
    const taps = [3, 0, 2, 1].map(i => KICKS[i] + 0.1)
    expect(estimateOffset(taps, KICKS)?.offsetMs).toBe(100)
  })

  it('sin toques o sin bombos no hay estimación', () => {
    expect(estimateOffset([], KICKS)).toBeNull()
    expect(estimateOffset([1], [])).toBeNull()
  })
})

describe('kickTimes y previewStartS', () => {
  const withNotes = (notes: ChartV2['difficulties']['full']['notes']): ChartV2 => {
    const base = analyzedChart()
    return { ...base, difficulties: { ...base.difficulties, full: { notes } } }
  }
  const note = (t: number, piece: 'kick' | 'snare') => ({ t, piece, velocity: 90, confidence: 1 })

  it('toma los bombos del chart completo, ordenados', () => {
    const chart = withNotes([note(4, 'kick'), note(2.5, 'snare'), note(1, 'kick')])
    expect(kickTimes(chart)).toEqual([1, 4])
  })

  it('sin bombos usa todas las notas', () => {
    expect(kickTimes(withNotes([note(3, 'snare')]))).toEqual([3])
  })

  it('la vista previa arranca 2 s antes del primer bombo, nunca antes de 0', () => {
    expect(previewStartS([5, 6])).toBe(3)
    expect(previewStartS([1])).toBe(0)
    expect(previewStartS([])).toBe(0)
  })
})

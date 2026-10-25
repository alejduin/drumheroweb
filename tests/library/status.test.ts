import { describe, expect, it } from 'vitest'
import { lowConfidenceCount, statusForChart } from '@/library/status'
import { analyzedChart } from '../fakes/FakeWorkerClient'

describe('estado de la canción', () => {
  it('por revisar desde el 10 % de notas dudosas', () => {
    expect(lowConfidenceCount(analyzedChart(20, 3))).toBe(3)
    expect(statusForChart(analyzedChart(20, 1))).toBe('ready')
    expect(statusForChart(analyzedChart(20, 2))).toBe('needs_review')
  })

  it('un chart sin notas queda por revisar', () => {
    expect(statusForChart(analyzedChart(0))).toBe('needs_review')
  })
})

describe('resumen desde el chart', () => {
  it('piezas presentes en orden del schema y notas dudosas por pieza', async () => {
    const { summaryFromChart } = await import('@/library/status')
    const chart = analyzedChart(4, 1)
    chart.difficulties.full.notes.push({ t: 9, piece: 'kick', velocity: 100, confidence: 0.3 })
    expect(summaryFromChart(chart)).toEqual({
      bpm: 120,
      timeSignature: [4, 4],
      durationS: 20,
      pieces: ['kick', 'snare'],
      lowConfidenceCount: 2,
      lowConfidenceByPiece: { snare: 1, kick: 1 },
    })
  })
})

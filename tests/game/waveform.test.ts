import { describe, expect, it } from 'vitest'
import { computePeaks, downsamplePeaks, xToTime } from '@/game/waveform'

describe('forma de onda', () => {
  it('reduce a N barras con el máximo de cada tramo', () => {
    expect(downsamplePeaks([0.1, 0.5, 0.2, 0.9, 0.3, 0.4], 3)).toEqual([0.5, 0.9, 0.4])
    expect(downsamplePeaks([0.2, 0.7], 4)).toEqual([0.2, 0.2, 0.7, 0.7])
    expect(downsamplePeaks([], 3)).toEqual([0, 0, 0])
    expect(downsamplePeaks([0.5], 0)).toEqual([])
  })

  it('calcula picos de un audio decodificado (todas las pistas, valor absoluto)', () => {
    const left = new Float32Array([0, 0.5, -0.25, 0, 0.1, 0])
    const right = new Float32Array([0, -0.75, 0, 0, 0, 0.2])
    const peaks = computePeaks(
      {
        numberOfChannels: 2,
        sampleRate: 8000,
        length: 6,
        getChannelData: c => (c === 0 ? left : right),
      },
      4,
    )
    expect(peaks.samplesPerPeak).toBe(4)
    expect(peaks.sampleRate).toBe(8000)
    expect(peaks.peaks).toHaveLength(2)
    expect(peaks.peaks[0]).toBeCloseTo(0.75)
    expect(peaks.peaks[1]).toBeCloseTo(0.2)
  })

  it('clic en la onda → tiempo, con clamp', () => {
    expect(xToTime(250, 1000, 200)).toBe(50)
    expect(xToTime(-10, 1000, 200)).toBe(0)
    expect(xToTime(2000, 1000, 200)).toBe(200)
    expect(xToTime(10, 0, 200)).toBe(0)
  })
})

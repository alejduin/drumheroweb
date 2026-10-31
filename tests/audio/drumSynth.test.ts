import { describe, expect, it } from 'vitest'
import { PIECES } from '@/types'
import { createKitBuffers, synthesizeHit } from '@/audio/drumSynth'

const RATE = 8000

describe('synthesizeHit', () => {
  it('cada pieza suena, sin saturar y termina en silencio', () => {
    for (const piece of PIECES) {
      const data = synthesizeHit(piece, RATE)
      const peak = data.reduce((m, x) => Math.max(m, Math.abs(x)), 0)
      expect(peak, piece).toBeGreaterThan(0.05)
      expect(peak, piece).toBeLessThanOrEqual(1)
      expect(Math.abs(data[data.length - 1]), piece).toBeLessThan(0.01)
    }
  })

  it('es determinista (mismo ruido en cada carga)', () => {
    expect(synthesizeHit('snare', RATE)).toEqual(synthesizeHit('snare', RATE))
  })

  it('los platillos duran más que el hi-hat cerrado', () => {
    expect(synthesizeHit('crash', RATE).length).toBeGreaterThan(
      synthesizeHit('hihat_closed', RATE).length,
    )
  })
})

describe('createKitBuffers', () => {
  it('un buffer mono por pieza a la frecuencia del contexto', () => {
    const created: Array<[number, number, number]> = []
    const ctx = {
      sampleRate: RATE,
      createBuffer(channels: number, length: number, sampleRate: number) {
        created.push([channels, length, sampleRate])
        const data = new Float32Array(length)
        return {
          duration: length / sampleRate,
          getChannelData: () => data,
        } as unknown as AudioBuffer
      },
    }
    const buffers = createKitBuffers(ctx)
    expect(Object.keys(buffers).sort()).toEqual([...PIECES].sort())
    expect(created.every(([ch, , rate]) => ch === 1 && rate === RATE)).toBe(true)
    expect(buffers.kick.getChannelData(0).some(x => x !== 0)).toBe(true)
  })
})

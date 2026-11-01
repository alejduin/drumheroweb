import { describe, expect, it } from 'vitest'
import { MAX_SHIFT_S, normalizeTempo, stretchChannels, stretchedLength } from '@/audio/timeStretch'

const SR = 8000

function sine(freq: number, seconds: number, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR))
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR)
  return out
}

/** Frecuencia por cruces por cero ascendentes en la zona central. */
function zeroCrossingFreq(signal: Float32Array): number {
  const from = Math.floor(signal.length * 0.2)
  const to = Math.floor(signal.length * 0.8)
  let crossings = 0
  for (let i = from + 1; i < to; i++) if (signal[i - 1] < 0 && signal[i] >= 0) crossings++
  return crossings / ((to - from) / SR)
}

function rms(signal: Float32Array, from = 0, to = signal.length): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += signal[i] ** 2
  return Math.sqrt(sum / (to - from))
}

/** Clicks: ráfagas cortas de ruido determinista en esos segundos. */
function clicks(times: number[], seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR))
  let seed = 7
  for (const t of times) {
    const at = Math.round(t * SR)
    for (let i = 0; i < 40; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      out[at + i] = ((seed / 0x7fffffff) * 2 - 1) * (1 - i / 40)
    }
  }
  return out
}

/** Instante (s) del pico de energía en una ventana alrededor de `aroundS`. */
function peakNear(signal: Float32Array, aroundS: number, spanS = 0.05): number {
  const from = Math.max(0, Math.round((aroundS - spanS) * SR))
  const to = Math.min(signal.length, Math.round((aroundS + spanS) * SR))
  let best = from
  for (let i = from; i < to; i++) if (Math.abs(signal[i]) > Math.abs(signal[best])) best = i
  return best / SR
}

describe('normalizeTempo', () => {
  it('limita a 50–100 % en pasos de 5 %', () => {
    expect(normalizeTempo(0.75)).toBe(0.75)
    expect(normalizeTempo(0.77)).toBe(0.75)
    expect(normalizeTempo(0.3)).toBe(0.5)
    expect(normalizeTempo(1.4)).toBe(1)
    expect(normalizeTempo(Number.NaN)).toBe(1)
  })
})

describe('stretchChannels', () => {
  it('a 100 % devuelve una copia idéntica', () => {
    const input = sine(220, 0.5)
    const [out] = stretchChannels([input], SR, 1)
    expect(out).toEqual(input)
    expect(out).not.toBe(input)
  })

  it('la salida dura duración / rate', () => {
    const input = sine(220, 1)
    for (const rate of [0.5, 0.75, 0.9]) {
      const [out] = stretchChannels([input], SR, rate)
      expect(out.length).toBe(stretchedLength(input.length, rate))
      expect(out.length).toBe(Math.round(SR / rate))
    }
  })

  it('no cambia el tono ni el volumen', () => {
    const input = sine(440, 2)
    for (const rate of [0.5, 0.75]) {
      const [out] = stretchChannels([input], SR, rate)
      expect(Math.abs(zeroCrossingFreq(out) - 440)).toBeLessThan(440 * 0.01)
      const mid = [Math.floor(out.length * 0.2), Math.floor(out.length * 0.8)] as const
      expect(rms(out, ...mid)).toBeCloseTo(rms(input), 1)
    }
  })

  it('cada golpe cae en t / rate (error acotado por MAX_SHIFT_S)', () => {
    const times = [0.25, 0.6, 1.1, 1.5, 1.9]
    const input = clicks(times, 2.2)
    const rate = 0.75
    const [out] = stretchChannels([input], SR, rate)
    for (const t of times) {
      const expected = t / rate
      // El error en la entrada (MAX_SHIFT_S) se ve dividido por el rate en la salida,
      // más media ventana de margen por la forma del click
      expect(Math.abs(peakNear(out, expected) - expected)).toBeLessThan(MAX_SHIFT_S / rate + 0.012)
    }
  })

  it('aplica la misma alineación a todos los canales', () => {
    const times = [0.3, 0.8, 1.3]
    const drums = clicks(times, 1.6)
    const backing = sine(330, 1.6, 0.2)
    const [outDrums, outBacking] = stretchChannels([drums, backing], SR, 0.6)
    // Una pista sola y la misma junto a otra: el golpe sale en el mismo sitio
    // relativo, y las dos pistas miden lo mismo
    expect(outDrums.length).toBe(outBacking.length)
    const [twin] = stretchChannels([drums, drums], SR, 0.6)
    for (const t of times) {
      expect(Math.abs(peakNear(twin, t / 0.6) - peakNear(outDrums, t / 0.6))).toBeLessThan(
        MAX_SHIFT_S / 0.6 + 0.012,
      )
    }
    // Dos canales idénticos dan dos salidas idénticas
    const [a, b] = stretchChannels([backing, backing], SR, 0.6)
    expect(a).toEqual(b)
  })

  it('rechaza un rate inválido o canales de distinto largo', () => {
    expect(() => stretchChannels([sine(1, 0.1)], SR, 0)).toThrow(RangeError)
    expect(() => stretchChannels([sine(1, 0.1), sine(1, 0.2)], SR, 0.5)).toThrow()
    expect(stretchChannels([], SR, 0.5)).toEqual([])
  })
})

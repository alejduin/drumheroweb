import type { WaveformPeaks } from '@/types'

// ─── Forma de onda del transporte ─────────────────────────────────────────────

/** Muestras por pico al calcular la onda en el cliente (igual que el worker: 10 ms a 44.1 kHz). */
export const CLIENT_SAMPLES_PER_PEAK = 441

/** Reduce los picos a `bins` barras (máximo de cada tramo), en 0–1. */
export function downsamplePeaks(peaks: readonly number[], bins: number): number[] {
  const count = Math.max(0, Math.floor(bins))
  if (count === 0) return []
  if (peaks.length === 0) return new Array<number>(count).fill(0)
  const out = new Array<number>(count)
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * peaks.length) / count)
    const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / count))
    let max = 0
    for (let j = from; j < to && j < peaks.length; j++) max = Math.max(max, Math.abs(peaks[j]))
    out[i] = Math.min(max, 1)
  }
  return out
}

/** Lo que se lee de un AudioBuffer para calcular la onda (fake en tests). */
export interface PcmSource {
  readonly numberOfChannels: number
  readonly sampleRate: number
  readonly length: number
  getChannelData(channel: number): Float32Array
}

/** Picos de un audio ya decodificado (cuando no hay peaks.json: MP3 original o charts incluidos). */
export function computePeaks(
  buffer: PcmSource,
  samplesPerPeak = CLIENT_SAMPLES_PER_PEAK,
): WaveformPeaks {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
    buffer.getChannelData(c),
  )
  const peaks: number[] = []
  for (let start = 0; start < buffer.length; start += samplesPerPeak) {
    const end = Math.min(start + samplesPerPeak, buffer.length)
    let max = 0
    for (const data of channels) {
      for (let i = start; i < end; i++) {
        const v = Math.abs(data[i])
        if (v > max) max = v
      }
    }
    peaks.push(Math.min(max, 1))
  }
  return { samplesPerPeak, sampleRate: buffer.sampleRate, peaks }
}

/** Posición x dentro de la onda → segundos de canción (clic = seek). */
export function xToTime(x: number, width: number, durationS: number): number {
  if (!(width > 0) || !(durationS > 0)) return 0
  return Math.min(Math.max(x / width, 0), 1) * durationS
}

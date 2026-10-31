import { PIECES } from '@/types'
import type { Piece } from '@/types'

// ─── Sonidos del kit sintetizados (PLAN_V2 C4) ───────────────────────────────
// Para "escuchar la transcripción" basta un kit reconocible, no realista: se
// generan en el navegador (sin archivos ni licencias). Cada pieza es una mezcla
// de tono con barrido de frecuencia y ruido filtrado, con envolvente exponencial.

interface Voice {
  durationS: number
  /** Tono: frecuencia inicial → final (Hz) y caída (s, constante de tiempo). */
  tone?: { from: number; to: number; sweepS: number; decayS: number; gain: number }
  /** Ruido: brillo 0 (opaco) a 1 (solo agudos) y caída. */
  noise?: { brightness: number; decayS: number; gain: number }
  /** Parciales metálicos (campana del ride). */
  bell?: { freqs: readonly number[]; decayS: number; gain: number }
}

const VOICES: Record<Piece, Voice> = {
  kick: { durationS: 0.45, tone: { from: 150, to: 48, sweepS: 0.04, decayS: 0.13, gain: 1 } },
  snare: {
    durationS: 0.3,
    tone: { from: 220, to: 180, sweepS: 0.02, decayS: 0.05, gain: 0.5 },
    noise: { brightness: 0.4, decayS: 0.07, gain: 0.7 },
  },
  snare_rim: {
    durationS: 0.12,
    tone: { from: 900, to: 800, sweepS: 0.005, decayS: 0.012, gain: 0.7 },
    noise: { brightness: 0.8, decayS: 0.01, gain: 0.4 },
  },
  hihat_closed: { durationS: 0.12, noise: { brightness: 1, decayS: 0.022, gain: 0.5 } },
  hihat_open: { durationS: 0.6, noise: { brightness: 1, decayS: 0.16, gain: 0.45 } },
  hihat_pedal: { durationS: 0.1, noise: { brightness: 0.9, decayS: 0.015, gain: 0.35 } },
  tom1: { durationS: 0.5, tone: { from: 260, to: 200, sweepS: 0.08, decayS: 0.14, gain: 0.8 } },
  tom2: { durationS: 0.55, tone: { from: 190, to: 145, sweepS: 0.09, decayS: 0.16, gain: 0.8 } },
  tom3: { durationS: 0.6, tone: { from: 130, to: 95, sweepS: 0.1, decayS: 0.18, gain: 0.85 } },
  crash: { durationS: 1.6, noise: { brightness: 0.85, decayS: 0.45, gain: 0.45 } },
  ride: {
    durationS: 1,
    noise: { brightness: 0.95, decayS: 0.25, gain: 0.25 },
    bell: { freqs: [520, 1340, 2610], decayS: 0.3, gain: 0.12 },
  },
}

/** Ruido pseudoaleatorio con semilla: el mismo sonido en cada carga (y en tests). */
function noiseSource(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    // xorshift32
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) / 0xffffffff) * 2 - 1
  }
}

/** Muestras (mono, −1…1) de un golpe de esa pieza a esa frecuencia de muestreo. */
export function synthesizeHit(piece: Piece, sampleRate: number): Float32Array {
  const voice = VOICES[piece]
  const length = Math.max(1, Math.round(voice.durationS * sampleRate))
  const out = new Float32Array(length)
  const random = noiseSource(PIECES.indexOf(piece) + 1)
  let phase = 0
  let prevNoise = 0
  let lowNoise = 0

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    let sample = 0

    if (voice.tone) {
      const { from, to, sweepS, decayS, gain } = voice.tone
      const freq = to + (from - to) * Math.exp(-t / sweepS)
      phase += (2 * Math.PI * freq) / sampleRate
      sample += Math.sin(phase) * gain * Math.exp(-t / decayS)
    }
    if (voice.noise) {
      const { brightness, decayS, gain } = voice.noise
      const white = random()
      // Paso alto simple (diferencia) mezclado con un paso bajo según el brillo
      const high = (white - prevNoise) * 0.5
      lowNoise += (white - lowNoise) * 0.3
      prevNoise = white
      const colored = high * brightness + lowNoise * (1 - brightness)
      sample += colored * gain * Math.exp(-t / decayS)
    }
    if (voice.bell) {
      const { freqs, decayS, gain } = voice.bell
      let bell = 0
      for (const f of freqs) bell += Math.sin(2 * Math.PI * f * t)
      sample += (bell / freqs.length) * gain * Math.exp(-t / decayS)
    }

    // Fundido final de 5 ms para no cortar en seco
    const tail = (length - i) / (0.005 * sampleRate)
    out[i] = Math.max(-1, Math.min(1, sample * Math.min(1, tail)))
  }
  return out
}

/** Lo mínimo de AudioContext para crear los buffers. */
export interface KitBufferContext {
  readonly sampleRate: number
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer
}

export type KitBuffers = Readonly<Record<Piece, AudioBuffer>>

/** Un AudioBuffer por pieza, listo para sonar. */
export function createKitBuffers(ctx: KitBufferContext): KitBuffers {
  const buffers = {} as Record<Piece, AudioBuffer>
  for (const piece of PIECES) {
    const data = synthesizeHit(piece, ctx.sampleRate)
    const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate)
    buffer.getChannelData(0).set(data)
    buffers[piece] = buffer
  }
  return buffers
}

// ─── Time-stretch sin cambio de tono (PLAN_V2 D2) ─────────────────────────────
// WSOLA (Waveform Similarity Overlap-Add) sobre todas las pistas a la vez: la
// alineación de cada ventana se decide con la mezcla en mono y se aplica igual a
// cada canal, así batería y backing siguen alineadas a la muestra.
//
// La salida dura duración / rate y la muestra n de la salida corresponde a la
// n·rate de la entrada, con un error acotado por MAX_SHIFT_S (en tiempo de
// canción). Por eso el reloj puede escalar con el rate sin más.
//
// Se procesa entero de una vez (offline, en un Web Worker): sin latencia extra
// ni deriva entre pistas mientras suena.

/** Ventana de análisis/síntesis (~23 ms): corta para no emborronar los golpes. */
export const FRAME_S = 0.023
/** Desplazamiento máximo de una ventana respecto de su posición nominal. */
export const MAX_SHIFT_S = 0.005
/** Rango de tempo que ofrece el juego. */
export const MIN_TEMPO = 0.5
export const MAX_TEMPO = 1
export const TEMPO_STEP = 0.05

/** Tempo válido: dentro de 50–100 % y en pasos de 5 %. */
export function normalizeTempo(rate: number): number {
  if (!Number.isFinite(rate)) return MAX_TEMPO
  const stepped = Math.round(rate / TEMPO_STEP) * TEMPO_STEP
  return Math.round(Math.min(Math.max(stepped, MIN_TEMPO), MAX_TEMPO) * 100) / 100
}

/** Muestras de salida para `length` muestras de entrada a ese rate. */
export function stretchedLength(length: number, rate: number): number {
  return Math.max(1, Math.round(length / rate))
}

/** Factor de diezmado para la búsqueda gruesa (~5,5 kHz). */
function decimationFor(sampleRate: number): number {
  return Math.max(1, Math.round(sampleRate / 5512))
}

/** Similitud normalizada entre `sig[a..a+len)` y `sig[b..b+len)` (sin comprobar límites). */
function similarity(sig: Float32Array, a: number, b: number, len: number): number {
  let dot = 0
  let energy = 0
  for (let i = 0; i < len; i++) {
    const x = sig[a + i]
    dot += x * sig[b + i]
    energy += x * x
  }
  return energy > 1e-12 ? dot / Math.sqrt(energy) : 0
}

/**
 * Estira (rate < 1) o comprime (rate > 1) los canales sin cambiar el tono.
 * Todos los canales deben tener el mismo largo; la salida mide stretchedLength.
 */
export function stretchChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
  rate: number,
): Float32Array[] {
  if (!(rate > 0)) throw new RangeError(`rate inválido: ${rate}`)
  if (channels.length === 0) return []
  const length = channels[0].length
  if (channels.some(c => c.length !== length)) {
    throw new Error('stretchChannels: los canales deben medir lo mismo')
  }
  if (rate === 1) return channels.map(c => c.slice())

  const outLength = stretchedLength(length, rate)
  // Ventana par: dos mitades que se solapan al 50 %
  const frame = Math.max(8, 2 * Math.round((FRAME_S * sampleRate) / 2))
  const hop = frame / 2
  const maxShift = Math.max(1, Math.round(MAX_SHIFT_S * sampleRate))
  const decim = decimationFor(sampleRate)

  // Guía en mono (la mezcla) para decidir la alineación de todas las pistas, con
  // ceros a los lados para que la búsqueda no tenga que comprobar límites
  const pad = frame + 2 * maxShift + decim
  const guide = new Float32Array(length + 2 * pad)
  for (const c of channels) for (let i = 0; i < length; i++) guide[pad + i] += c[i]
  // Versión diezmada (promedio de `decim` muestras) para la búsqueda gruesa
  const coarse = new Float32Array(Math.ceil(guide.length / decim))
  for (let i = 0; i < guide.length; i++) coarse[(i / decim) | 0] += guide[i] / decim
  const coarseHop = Math.max(1, Math.round(hop / decim))

  // Hann (sin²): con solape al 50 % las ventanas suman exactamente 1
  const window = new Float32Array(frame)
  for (let i = 0; i < frame; i++) window[i] = Math.sin((Math.PI * i) / frame) ** 2

  const outputs = channels.map(() => new Float32Array(outLength))
  // La ventana k empieza en la salida en (k − 1)·hop: la primera ya cubre el arranque
  let prevStart = -hop
  for (let k = 0; (k - 1) * hop < outLength; k++) {
    const outStart = (k - 1) * hop
    const nominal = Math.round(outStart * rate)
    let start = nominal
    if (k > 0) {
      // Lo que seguiría naturalmente a la ventana anterior: la nueva debe parecerse
      const target = prevStart + hop
      const lo = nominal - maxShift
      const hi = nominal + maxShift
      // Búsqueda gruesa diezmada y luego fina alrededor del mejor candidato
      let best = nominal
      let bestScore = -Infinity
      const coarseTarget = Math.round((target + pad) / decim)
      for (let s = lo; s <= hi; s += decim) {
        const score = similarity(coarse, Math.round((s + pad) / decim), coarseTarget, coarseHop)
        if (score > bestScore) {
          bestScore = score
          best = s
        }
      }
      bestScore = -Infinity
      const center = best
      for (let s = Math.max(lo, center - decim + 1); s <= Math.min(hi, center + decim - 1); s++) {
        const score = similarity(guide, s + pad, target + pad, hop)
        if (score > bestScore) {
          bestScore = score
          best = s
        }
      }
      start = best
    }

    for (let ch = 0; ch < channels.length; ch++) {
      const input = channels[ch]
      const output = outputs[ch]
      for (let i = 0; i < frame; i++) {
        const o = outStart + i
        if (o < 0 || o >= outLength) continue
        const s = start + i
        if (s < 0 || s >= length) continue
        output[o] += input[s] * window[i]
      }
    }
    prevStart = start
  }
  return outputs
}

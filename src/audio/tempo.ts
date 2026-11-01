import type { StretchRequest, StretchResponse } from './timeStretch.worker'

// ─── Pistas a otro tempo (PLAN_V2 D2) ─────────────────────────────────────────

/** Estira canales a `rate` (en un worker en la app; síncrono en tests). */
export type StretchFn = (
  channels: Float32Array[],
  sampleRate: number,
  rate: number,
  signal?: AbortSignal,
) => Promise<Float32Array[]>

/** Lo que hace falta del AudioContext para armar los buffers estirados. */
export interface StretchBufferContext {
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer
}

function abortError(): DOMException {
  return new DOMException('time-stretch cancelado', 'AbortError')
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Estira en un Web Worker propio; abortar lo termina en el acto. */
export const stretchInWorker: StretchFn = (channels, sampleRate, rate, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const worker = new Worker(new URL('./timeStretch.worker.ts', import.meta.url), {
      type: 'module',
    })
    const onAbort = () => {
      cleanup()
      reject(abortError())
    }
    const cleanup = () => {
      worker.terminate()
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort)
    worker.onmessage = (event: MessageEvent<StretchResponse>) => {
      cleanup()
      if (event.data.channels) resolve(event.data.channels)
      else reject(new Error(event.data.error ?? 'time-stretch sin resultado'))
    }
    worker.onerror = event => {
      cleanup()
      reject(new Error(event.message || 'falló el worker de time-stretch'))
    }
    const request: StretchRequest = { channels, sampleRate, rate }
    worker.postMessage(
      request,
      channels.map(c => c.buffer),
    )
  })

/**
 * Las pistas de la canción a `rate`, estiradas juntas (misma alineación en todas,
 * así siguen sincronizadas entre sí). Devuelve un buffer por pista, en orden.
 */
export async function stretchBuffers(
  ctx: StretchBufferContext,
  buffers: readonly AudioBuffer[],
  rate: number,
  stretch: StretchFn,
  signal?: AbortSignal,
): Promise<AudioBuffer[]> {
  if (buffers.length === 0) return []
  const { sampleRate } = buffers[0]
  if (buffers.some(b => b.sampleRate !== sampleRate)) {
    throw new Error('stretchBuffers: las pistas deben tener la misma frecuencia de muestreo')
  }
  // Todas al largo de la más larga (una pista corta se rellena con silencio)
  const length = Math.max(...buffers.map(b => b.length))
  const channels: Float32Array[] = []
  for (const buffer of buffers) {
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = new Float32Array(length)
      data.set(buffer.getChannelData(c))
      channels.push(data)
    }
  }
  const out = await stretch(channels, sampleRate, rate, signal)
  if (signal?.aborted) throw abortError()
  let next = 0
  return buffers.map(buffer => {
    const stretched = ctx.createBuffer(buffer.numberOfChannels, out[0].length, sampleRate)
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      stretched.getChannelData(c).set(out[next++])
    }
    return stretched
  })
}

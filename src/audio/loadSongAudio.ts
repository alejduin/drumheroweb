import type { MixChannel } from './Mixer'

/**
 * Audio ya resuelto: bytes, Blob (archivo o IndexedDB) o URL http(s)/blob:.
 * Las URLs storage:// e idb:// del chart las resuelve la capa de almacenamiento (B13).
 */
export type AudioSource = ArrayBuffer | Blob | string

export interface SongAudioSources {
  stems: { drums: AudioSource; backing: AudioSource } | null
  original: AudioSource | null
}

export interface DecodedTrack {
  channel: MixChannel
  buffer: AudioBuffer
}

export interface SongAudio {
  /** stems = batería y backing por separado; original = solo el MP3 (sin control de batería). */
  mode: 'stems' | 'original'
  tracks: DecodedTrack[]
  /** Por qué no se usaron los stems, si se pidieron y fallaron. */
  fallbackReason: string | null
}

export interface DecodeContext {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>
}

export type FetchBytes = (url: string) => Promise<ArrayBuffer>

async function defaultFetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`no se pudo descargar ${url}: ${response.status}`)
  return response.arrayBuffer()
}

async function toBytes(source: AudioSource, fetchBytes: FetchBytes): Promise<ArrayBuffer> {
  if (typeof source === 'string') return fetchBytes(source)
  if (source instanceof ArrayBuffer) return source
  return source.arrayBuffer()
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Descarga y decodifica el audio de una canción. Prefiere los stems; si faltan o
 * alguno falla, usa el MP3 original en el canal backing (fallback, PLAN_V2 B4).
 * Lanza solo si no se puede reproducir nada.
 */
export async function loadSongAudio(
  ctx: DecodeContext,
  sources: SongAudioSources,
  fetchBytes: FetchBytes = defaultFetchBytes,
): Promise<SongAudio> {
  const decode = async (source: AudioSource) =>
    ctx.decodeAudioData(await toBytes(source, fetchBytes))

  let fallbackReason: string | null = null
  if (sources.stems) {
    try {
      const [drums, backing] = await Promise.all([
        decode(sources.stems.drums),
        decode(sources.stems.backing),
      ])
      return {
        mode: 'stems',
        tracks: [
          { channel: 'drums', buffer: drums },
          { channel: 'backing', buffer: backing },
        ],
        fallbackReason: null,
      }
    } catch (error) {
      fallbackReason = `stems no disponibles: ${describe(error)}`
    }
  }

  if (!sources.original) {
    throw new Error(fallbackReason ?? 'la canción no tiene audio')
  }
  const original = await decode(sources.original)
  return { mode: 'original', tracks: [{ channel: 'backing', buffer: original }], fallbackReason }
}

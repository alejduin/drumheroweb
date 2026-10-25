import { metaFromFileName, validateAudioFile, validateDuration } from './audioFile'
import { id3TagLength, readId3Tags } from './id3'
import type { Id3Tags } from './id3'

// ─── Lectura del archivo elegido en Importar (solo navegador) ────────────────

/** Tope de lo que se lee para las etiquetas (la carátula puede ser grande). */
const MAX_TAG_BYTES = 4 * 1024 * 1024

export type AudioFileInfo =
  | { ok: true; durationS: number; title: string; artist: string }
  | { ok: false; error: string }

/** Duración desde los metadatos del <audio> (sin decodificar todo el archivo). */
function measureDuration(file: Blob): Promise<number> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    const done = (duration: number) => {
      URL.revokeObjectURL(url)
      audio.removeAttribute('src')
      resolve(duration)
    }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => done(audio.duration)
    audio.onerror = () => done(NaN)
    audio.src = url
  })
}

async function readTags(file: File): Promise<Id3Tags> {
  const length = id3TagLength(await file.slice(0, 10).arrayBuffer())
  if (length === 0) return {}
  return readId3Tags(await file.slice(0, Math.min(length, MAX_TAG_BYTES)).arrayBuffer())
}

/** Valida el archivo y sugiere título y artista (ID3 o nombre del archivo). */
export async function readAudioFile(file: File): Promise<AudioFileInfo> {
  const invalid = validateAudioFile(file)
  if (invalid) return { ok: false, error: invalid }
  const [durationS, tags] = await Promise.all([
    measureDuration(file),
    readTags(file).catch((): Id3Tags => ({})),
  ])
  const tooLong = validateDuration(durationS)
  if (tooLong) return { ok: false, error: tooLong }
  const fromName = metaFromFileName(file.name)
  return {
    ok: true,
    durationS,
    title: tags.title ?? fromName.title,
    artist: tags.artist ?? fromName.artist,
  }
}

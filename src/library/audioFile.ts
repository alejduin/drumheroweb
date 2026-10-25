import { MAX_AUDIO_DURATION_S } from '@/constants/chart'

// ─── Validación del audio en el cliente (Importar) ───────────────────────────
// Mismos límites que el worker (PLAN_V2 §3): así el usuario se entera antes de subir.

export const ACCEPTED_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a'] as const
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/** Para el atributo accept del input de archivo. */
export const AUDIO_ACCEPT = ACCEPTED_AUDIO_EXTENSIONS.join(',')

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

/** Tipo y tamaño (antes de decodificar). null si es válido. */
export function validateAudioFile(file: { name: string; size: number }): string | null {
  if (!(ACCEPTED_AUDIO_EXTENSIONS as readonly string[]).includes(extensionOf(file.name))) {
    return 'Formato no soportado: usa MP3, WAV o M4A.'
  }
  if (file.size === 0) return 'El archivo está vacío.'
  if (file.size > MAX_UPLOAD_BYTES) {
    return `El archivo pesa ${(file.size / (1 << 20)).toFixed(0)} MB; el máximo es 50 MB.`
  }
  return null
}

/** Duración tras decodificar. null si es válida. */
export function validateDuration(durationS: number): string | null {
  if (!Number.isFinite(durationS) || durationS <= 0) return 'No se pudo leer el audio.'
  if (durationS > MAX_AUDIO_DURATION_S) {
    return `La canción dura ${(durationS / 60).toFixed(1)} min; el máximo es 10 min.`
  }
  return null
}

/** "Artista - Título.mp3" → { artist, title }; si no, el nombre sin extensión como título. */
export function metaFromFileName(name: string): { title: string; artist: string } {
  const dot = name.lastIndexOf('.')
  const stem = (dot > 0 ? name.slice(0, dot) : name).replace(/_/g, ' ').trim()
  const parts = stem.split(/\s+-\s+/)
  if (parts.length === 2 && parts[0] && parts[1]) return { artist: parts[0], title: parts[1] }
  return { title: stem, artist: '' }
}

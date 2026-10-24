import { parseSong } from '@/engine/SongParser'
import type { SongData } from '@/types'

/**
 * Carga y parsea un archivo JSON de canción desde /public/songs/.
 * Lanza un error si el fetch falla o el JSON es inválido.
 */
export async function loadSong(id: string): Promise<SongData> {
  const response = await fetch(`/songs/${id}.json`)
  if (!response.ok) {
    throw new Error(`No se pudo cargar la canción "${id}": ${response.status}`)
  }
  const raw: unknown = await response.json()
  return parseSong(raw)
}

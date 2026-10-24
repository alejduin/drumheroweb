import type { ChartV2 } from '@/types'

/**
 * Carga y valida un chart v2 desde /public/songs/.
 * Lanza si el fetch falla o el chart es inválido (ChartParseError).
 */
export async function loadChart(id: string): Promise<ChartV2> {
  const response = await fetch(`/songs/${id}.json`)
  if (!response.ok) {
    throw new Error(`No se pudo cargar la canción "${id}": ${response.status}`)
  }
  const raw: unknown = await response.json()
  // ajv + schema van en un chunk aparte: solo se descargan al cargar la primera canción
  const { parseChart } = await import('@/chart/ChartParser')
  return parseChart(raw)
}

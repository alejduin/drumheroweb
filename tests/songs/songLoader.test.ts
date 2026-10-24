import { afterEach, describe, expect, it, vi } from 'vitest'
import { SONG_LIBRARY } from '@/songs/songLibrary'
import { loadChart } from '@/songs/songLoader'

const songFiles = import.meta.glob('/public/songs/*.json', { eager: true, import: 'default' })

function serve(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status: ok ? 200 : 404, json: async () => body })),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('loadChart', () => {
  it.each(SONG_LIBRARY)('$id carga como chart v2', async ({ id, title, bpm }) => {
    serve(songFiles[`/public/songs/${id}.json`])
    const chart = await loadChart(id)
    expect(fetch).toHaveBeenCalledWith(`/songs/${id}.json`)
    expect(chart).toMatchObject({ version: 2, id, title, bpm })
  })

  it('propaga el error HTTP', async () => {
    serve(null, false)
    await expect(loadChart('nada')).rejects.toThrow('No se pudo cargar la canción "nada": 404')
  })

  it('rechaza un chart inválido', async () => {
    serve({ version: 2, id: 'x' })
    await expect(loadChart('x')).rejects.toThrow(/chart inválido/)
  })
})

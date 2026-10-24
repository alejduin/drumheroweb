import { describe, expect, it, vi } from 'vitest'
import { loadSongAudio } from '@/audio/loadSongAudio'
import type { DecodeContext } from '@/audio/loadSongAudio'
import { fakeBuffer } from '../fakes/FakeAudioContext'

/** "Decodifica" bytes cuyo primer byte es la duración; 0 = archivo corrupto. */
function decoder(): DecodeContext {
  return {
    decodeAudioData: vi.fn(async (data: ArrayBuffer) => {
      const duration = new Uint8Array(data)[0]
      if (!duration) throw new Error('EncodingError')
      return fakeBuffer(duration)
    }),
  }
}

const bytes = (duration: number) => new Uint8Array([duration]).buffer

describe('loadSongAudio', () => {
  it('con stems decodifica batería y backing en sus canales', async () => {
    const audio = await loadSongAudio(decoder(), {
      stems: { drums: bytes(30), backing: new Blob([new Uint8Array([31])]) },
      original: bytes(32),
    })
    expect(audio.mode).toBe('stems')
    expect(audio.tracks.map(t => [t.channel, t.buffer.duration])).toEqual([
      ['drums', 30],
      ['backing', 31],
    ])
    expect(audio.fallbackReason).toBeNull()
  })

  it('descarga las URLs con el fetcher', async () => {
    const fetchBytes = vi.fn(async (url: string) => bytes(url.endsWith('drums.ogg') ? 10 : 11))
    const audio = await loadSongAudio(
      decoder(),
      { stems: { drums: '/x/drums.ogg', backing: '/x/backing.ogg' }, original: null },
      fetchBytes,
    )
    expect(fetchBytes).toHaveBeenCalledTimes(2)
    expect(audio.tracks.map(t => t.buffer.duration)).toEqual([10, 11])
  })

  it('si un stem falla usa el original en backing y dice por qué', async () => {
    const audio = await loadSongAudio(decoder(), {
      stems: { drums: bytes(0), backing: bytes(30) },
      original: bytes(30),
    })
    expect(audio.mode).toBe('original')
    expect(audio.tracks).toEqual([{ channel: 'backing', buffer: fakeBuffer(30) }])
    expect(audio.fallbackReason).toBe('stems no disponibles: EncodingError')
  })

  it('sin stems usa el original sin motivo de fallback', async () => {
    const audio = await loadSongAudio(decoder(), { stems: null, original: bytes(20) })
    expect(audio).toMatchObject({ mode: 'original', fallbackReason: null })
  })

  it('falla solo si no hay nada que reproducir', async () => {
    await expect(loadSongAudio(decoder(), { stems: null, original: null })).rejects.toThrow(
      'la canción no tiene audio',
    )
    await expect(
      loadSongAudio(decoder(), { stems: { drums: bytes(0), backing: bytes(1) }, original: null }),
    ).rejects.toThrow(/stems no disponibles/)
  })
})

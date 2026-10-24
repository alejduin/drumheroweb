import { describe, expect, it } from 'vitest'
import type { ChartV2 } from '@/types'
import { builtinBundle, fileNameOf } from '@/songs/songBundle'

const base = { audioUrl: null, stems: null } as unknown as ChartV2

describe('songBundle', () => {
  it('nombre de archivo de una URL', () => {
    expect(fileNameOf('storage://songs/Enter%20Sandman.mp3')).toBe('Enter Sandman.mp3')
    expect(fileNameOf('/audio/a.ogg')).toBe('a.ogg')
    expect(fileNameOf(null)).toBeNull()
  })

  it('canción incluida sin audio → pista silenciosa', () => {
    expect(builtinBundle(base).audio).toBeNull()
  })

  it('usa las URLs descargables e ignora storage:// (las resuelve B13)', () => {
    const withAudio = { ...base, audioUrl: '/songs/a.mp3' } as ChartV2
    expect(builtinBundle(withAudio).audio).toEqual({ stems: null, original: '/songs/a.mp3' })
    expect(builtinBundle(withAudio).fileName).toBe('a.mp3')
    const stored = {
      ...base,
      audioUrl: 'storage://songs/a.mp3',
      stems: { drums: 'storage://d.ogg', backing: 'storage://b.ogg' },
    } as ChartV2
    expect(builtinBundle(stored).audio).toBeNull()
  })
})

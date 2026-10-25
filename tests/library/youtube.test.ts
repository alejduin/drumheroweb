import { describe, expect, it } from 'vitest'
import { parseYouTubeId, youTubeWatchUrl } from '@/library/youtube'

const ID = 'dQw4w9WgXcQ'

describe('URL de YouTube', () => {
  it('reconoce los formatos habituales', () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&t=42s`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://music.youtube.com/watch?v=${ID}&list=abc`,
      `https://youtu.be/${ID}?si=xyz`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `  https://youtu.be/${ID}  `,
    ]) {
      expect(parseYouTubeId(url), url).toBe(ID)
    }
  })

  it('rechaza lo que no es un video de YouTube', () => {
    for (const url of [
      '',
      'hola',
      `https://vimeo.com/${ID}`,
      'https://www.youtube.com/watch?v=corto',
      'https://www.youtube.com/channel/UC123',
      `javascript:alert('${ID}')`,
      `https://evil.com/watch?v=${ID}`,
    ]) {
      expect(parseYouTubeId(url), url).toBeNull()
    }
  })

  it('genera la URL canónica', () => {
    expect(youTubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`)
  })
})

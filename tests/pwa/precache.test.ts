import { describe, expect, it } from 'vitest'
import { precacheList, serviceWorkerSource } from '@pwa/precache'

describe('precache del service worker', () => {
  it('incluye el shell y omite el SW, mapas, woff y ocultos', () => {
    expect(
      precacheList([
        'index.html',
        'sw.js',
        'manifest.json',
        'assets\\index-abc.js',
        'assets/index-abc.js.map',
        'assets/inter-latin.woff2',
        'assets/inter-latin.woff',
        'songs/demo.json',
        '.DS_Store',
      ]),
    ).toEqual([
      '/',
      '/assets/index-abc.js',
      '/assets/inter-latin.woff2',
      '/manifest.json',
      '/songs/demo.json',
    ])
  })

  it('inyecta lista y versión en la plantilla', () => {
    const src = serviceWorkerSource(
      'const P = self.__PRECACHE__\nconst V = self.__VERSION__',
      ['/', '/a.js'],
      'abc',
    )
    expect(src).toBe('const P = ["/","/a.js"]\nconst V = "abc"')
    expect(() => serviceWorkerSource('nada', [], 'x')).toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { readId3Tags } from '@/library/id3'

const synchsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const latin1 = (s: string) => [...s].map(c => c.charCodeAt(0))
const utf16le = (s: string) => [
  0xff,
  0xfe,
  ...[...s].flatMap(c => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]),
]

function frame(version: 2 | 3 | 4, id: string, encoding: number, text: number[]): number[] {
  const body = [encoding, ...text]
  if (version === 2)
    return [
      ...latin1(id),
      (body.length >> 16) & 0xff,
      (body.length >> 8) & 0xff,
      body.length & 0xff,
      ...body,
    ]
  const size = version === 4 ? synchsafe(body.length) : be32(body.length)
  return [...latin1(id), ...size, 0, 0, ...body]
}

function tag(version: 2 | 3 | 4, frames: number[][], padding = 16): ArrayBuffer {
  const content = [...frames.flat(), ...new Array<number>(padding).fill(0)]
  const bytes = [
    0x49,
    0x44,
    0x33,
    version,
    0,
    0,
    ...synchsafe(content.length),
    ...content,
    0xff,
    0xfb,
  ]
  return new Uint8Array(bytes).buffer
}

describe('ID3v2', () => {
  it('lee título y artista en ID3v2.3 (latin1 y UTF-16)', () => {
    const buffer = tag(3, [
      frame(3, 'TALB', 0, latin1('Elephant')),
      frame(3, 'TIT2', 1, utf16le('Canción')),
      frame(3, 'TPE1', 0, latin1('The White Stripes')),
    ])
    expect(readId3Tags(buffer)).toEqual({ title: 'Canción', artist: 'The White Stripes' })
  })

  it('lee ID3v2.4 con UTF-8 y tamaños synchsafe', () => {
    const title = [...new TextEncoder().encode('Ñandú ♪'), 0]
    const buffer = tag(4, [
      frame(4, 'TIT2', 3, title),
      frame(4, 'TPE1', 3, [...new TextEncoder().encode('Artista')]),
    ])
    expect(readId3Tags(buffer)).toEqual({ title: 'Ñandú ♪', artist: 'Artista' })
  })

  it('lee los marcos de 3 letras de ID3v2.2', () => {
    const buffer = tag(2, [
      frame(2, 'TT2', 0, latin1('Viejo')),
      frame(2, 'TP1', 0, latin1('Grupo')),
    ])
    expect(readId3Tags(buffer)).toEqual({ title: 'Viejo', artist: 'Grupo' })
  })

  it('sin etiqueta o truncado no lanza', () => {
    expect(readId3Tags(new Uint8Array([0xff, 0xfb, 0x90, 0x00]).buffer)).toEqual({})
    expect(readId3Tags(new ArrayBuffer(0))).toEqual({})
    const truncated = tag(3, [frame(3, 'TIT2', 0, latin1('Corto'))]).slice(0, 16)
    expect(readId3Tags(truncated)).toEqual({})
  })
})

describe('tamaño de la etiqueta', () => {
  it('cabecera + contenido', async () => {
    const { id3TagLength } = await import('@/library/id3')
    const buffer = tag(3, [frame(3, 'TIT2', 0, latin1('X'))], 0)
    expect(id3TagLength(buffer.slice(0, 10))).toBe(buffer.byteLength - 2)
    expect(id3TagLength(new ArrayBuffer(10))).toBe(0)
  })
})

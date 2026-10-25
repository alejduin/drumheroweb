import { describe, expect, it } from 'vitest'
import {
  MAX_UPLOAD_BYTES,
  metaFromFileName,
  validateAudioFile,
  validateDuration,
} from '@/library/audioFile'

describe('validación del audio', () => {
  it('acepta MP3, WAV y M4A (sin importar mayúsculas)', () => {
    for (const name of ['a.mp3', 'b.WAV', 'c.m4a']) {
      expect(validateAudioFile({ name, size: 1000 })).toBeNull()
    }
  })

  it('rechaza otros formatos, vacíos y archivos de más de 50 MB', () => {
    expect(validateAudioFile({ name: 'a.ogg', size: 1000 })).toMatch(/Formato/)
    expect(validateAudioFile({ name: 'sin-extension', size: 1000 })).toMatch(/Formato/)
    expect(validateAudioFile({ name: 'a.mp3', size: 0 })).toMatch(/vacío/)
    expect(validateAudioFile({ name: 'a.mp3', size: MAX_UPLOAD_BYTES })).toBeNull()
    expect(validateAudioFile({ name: 'a.mp3', size: MAX_UPLOAD_BYTES + 1 })).toMatch(/50 MB/)
  })

  it('la duración máxima es 10 minutos', () => {
    expect(validateDuration(600)).toBeNull()
    expect(validateDuration(601)).toMatch(/10 min/)
    expect(validateDuration(NaN)).toMatch(/leer/)
    expect(validateDuration(0)).toMatch(/leer/)
  })

  it('saca título y artista del nombre del archivo', () => {
    expect(metaFromFileName('The White Stripes - Seven Nation Army.mp3')).toEqual({
      artist: 'The White Stripes',
      title: 'Seven Nation Army',
    })
    expect(metaFromFileName('mi_cancion.wav')).toEqual({ title: 'mi cancion', artist: '' })
  })
})

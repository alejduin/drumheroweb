import { describe, expect, it } from 'vitest'
import { flattenNotes, parseSong, positionToMs } from '@/chart/parseV1'

// ─── positionToMs ─────────────────────────────────────────────────────────────

describe('positionToMs', () => {
  const BPM = 80
  const MS_PER_BEAT = 60_000 / 80 // 750ms

  it('beat 1 del compás 1 = 0ms', () => {
    expect(positionToMs(1, 1, 0, BPM, 4)).toBe(0)
  })

  it('beat 2 del compás 1 = 1 msPerBeat', () => {
    expect(positionToMs(1, 2, 0, BPM, 4)).toBe(MS_PER_BEAT)
  })

  it('beat 1 del compás 2 = 4 msPerBeat (compás completo 4/4)', () => {
    expect(positionToMs(2, 1, 0, BPM, 4)).toBe(4 * MS_PER_BEAT)
  })

  it('subdivision 0.5 = mitad del beat (corchea)', () => {
    const result = positionToMs(1, 1, 0.5, BPM, 4)
    expect(result).toBeCloseTo(MS_PER_BEAT * 0.5)
  })

  it('subdivision 0.25 = semicorchea', () => {
    const result = positionToMs(1, 1, 0.25, BPM, 4)
    expect(result).toBeCloseTo(MS_PER_BEAT * 0.25)
  })

  it('funciona con compás 3/4', () => {
    // Beat 1 del compás 2 en 3/4 = 3 beats = 3 * 750 = 2250ms
    expect(positionToMs(2, 1, 0, BPM, 3)).toBe(3 * MS_PER_BEAT)
  })

  it('funciona con BPM 120', () => {
    // msPerBeat a 120 BPM = 500ms
    expect(positionToMs(1, 2, 0, 120, 4)).toBe(500)
  })
})

// ─── parseSong ────────────────────────────────────────────────────────────────

const MINIMAL_RAW_SONG = {
  id: 'test-001',
  title: 'Test Song',
  bpm: 80,
  measures: [
    {
      number: 1,
      notes: [
        { beat: 1, subdivision: 0, instrument: 'kick', midi: 36 },
        { beat: 2, subdivision: 0, instrument: 'snare', midi: 38 },
      ],
    },
  ],
}

describe('parseSong', () => {
  it('parsea una canción mínima correctamente', () => {
    const song = parseSong(MINIMAL_RAW_SONG)
    expect(song.id).toBe('test-001')
    expect(song.title).toBe('Test Song')
    expect(song.bpm).toBe(80)
    expect(song.measures).toHaveLength(1)
  })

  it('aplica defaults para campos opcionales', () => {
    const song = parseSong(MINIMAL_RAW_SONG)
    expect(song.artist).toBe('Desconocido')
    expect(song.difficulty).toBe('beginner')
    expect(song.youtubeUrl).toBeNull()
    expect(song.youtubeOffsetMs).toBe(0)
    expect(song.timeSignature).toEqual([4, 4])
    expect(song.sections).toEqual([])
  })

  it('calcula absoluteTimeMs para notas del compás 1', () => {
    const song = parseSong(MINIMAL_RAW_SONG)
    const notes = song.measures[0].notes
    expect(notes[0].absoluteTimeMs).toBe(0) // beat 1 = 0ms
    expect(notes[1].absoluteTimeMs).toBe(750) // beat 2 a 80 BPM = 750ms
  })

  it('calcula absoluteTimeMs para notas del compás 2', () => {
    const raw = {
      ...MINIMAL_RAW_SONG,
      measures: [
        {
          number: 2,
          notes: [{ beat: 1, subdivision: 0, instrument: 'kick', midi: 36 }],
        },
      ],
    }
    const song = parseSong(raw)
    // Compás 2, beat 1, 4/4, 80 BPM → 4 * 750 = 3000ms
    expect(song.measures[0].notes[0].absoluteTimeMs).toBe(3000)
  })

  it('parsea secciones si se proveen', () => {
    const raw = {
      ...MINIMAL_RAW_SONG,
      sections: [{ name: 'Intro', startMeasure: 1, endMeasure: 4 }],
    }
    const song = parseSong(raw)
    expect(song.sections).toHaveLength(1)
    expect(song.sections[0].name).toBe('Intro')
  })

  it('lanza si faltan campos requeridos', () => {
    expect(() => parseSong({ title: 'sin id', bpm: 80, measures: [] })).toThrow()
    expect(() => parseSong({ id: 'x', title: 'y', measures: [] })).toThrow() // sin bpm
    expect(() => parseSong(null)).toThrow()
    expect(() => parseSong('string')).toThrow()
  })

  it('lanza si bpm es inválido', () => {
    expect(() => parseSong({ ...MINIMAL_RAW_SONG, bpm: 0 })).toThrow()
    expect(() => parseSong({ ...MINIMAL_RAW_SONG, bpm: -120 })).toThrow()
  })
})

// ─── flattenNotes ─────────────────────────────────────────────────────────────

describe('flattenNotes', () => {
  it('aplana todas las notas de todos los compases en orden cronológico', () => {
    const raw = {
      id: 'x',
      title: 'x',
      bpm: 80,
      measures: [
        {
          number: 1,
          notes: [
            { beat: 2, subdivision: 0, instrument: 'snare', midi: 38 },
            { beat: 1, subdivision: 0, instrument: 'kick', midi: 36 },
          ],
        },
        {
          number: 2,
          notes: [{ beat: 1, subdivision: 0, instrument: 'crash', midi: 49 }],
        },
      ],
    }
    const song = parseSong(raw)
    const notes = flattenNotes(song)

    expect(notes).toHaveLength(3)
    // Deben estar ordenadas por absoluteTimeMs
    expect(notes[0].instrument).toBe('kick') // beat 1 = 0ms
    expect(notes[1].instrument).toBe('snare') // beat 2 = 750ms
    expect(notes[2].instrument).toBe('crash') // compás 2 beat 1 = 3000ms
    expect(notes[0].absoluteTimeMs).toBeLessThan(notes[1].absoluteTimeMs)
    expect(notes[1].absoluteTimeMs).toBeLessThan(notes[2].absoluteTimeMs)
  })

  it('retorna array vacío para canción sin notas', () => {
    const song = parseSong({ id: 'x', title: 'x', bpm: 120, measures: [] })
    expect(flattenNotes(song)).toEqual([])
  })
})

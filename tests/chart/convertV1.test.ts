import { describe, expect, it } from 'vitest'
import { DIFFICULTIES } from '@/types'
import { flattenNotes, parseSong } from '@/engine/SongParser'
import { chartIssues, parseChart } from '@/chart/ChartParser'
import { V1_DEFAULT_VELOCITY, convertV1ToV2, isChartV1 } from '@/chart/convertV1'
import { timeToMeasureBeat } from '@/chart/grid'
import { chartToSongData } from '@/chart/legacy'

// Originales v1 (antes de la migración) y los charts que se sirven hoy
const v1Files = import.meta.glob('/tests/fixtures/v1/*.json', { eager: true, import: 'default' })
const songFiles = import.meta.glob('/public/songs/*.json', { eager: true, import: 'default' })

const CREATED_AT = '2026-10-24T00:00:00.000Z'
const fileName = (path: string) => path.split('/').pop()!

const v1Songs = Object.entries(v1Files).map(([path, raw]) => ({ name: fileName(path), raw }))

describe('convertV1ToV2', () => {
  it('hay fixtures para cada canción incluida', () => {
    expect(v1Songs.map(s => s.name).sort()).toEqual(Object.keys(songFiles).map(fileName).sort())
  })

  it.each(v1Songs)('$name: los tiempos son idénticos a los del motor v1', ({ raw }) => {
    const chart = convertV1ToV2(raw, CREATED_AT)
    const v1Times = flattenNotes(parseSong(raw)).map(n => n.absoluteTimeMs / 1000)
    const v2Times = chart.difficulties.full.notes.map(n => n.t)
    expect(v2Times).toEqual(v1Times.sort((a, b) => a - b))
  })

  it.each(v1Songs)('$name: produce un chart válido con rejilla a BPM constante', ({ raw }) => {
    const chart = convertV1ToV2(raw, CREATED_AT)
    expect(chartIssues(chart)).toEqual([])
    const spb = 60 / chart.bpm
    const [beatsPerMeasure] = chart.timeSignature
    expect(chart.grid.beats[1]).toBe(spb)
    expect(chart.grid.downbeats.length * beatsPerMeasure).toBe(chart.grid.beats.length)
    expect(chart.durationS).toBeCloseTo(chart.grid.beats.length * spb, 9)
    expect(chart.difficulties.basic.notes).toEqual([])
    expect(chart.difficulties.full.notes.every(n => n.velocity === V1_DEFAULT_VELOCITY)).toBe(true)
  })

  it.each(v1Songs)('$name: compás y beat v1 se recuperan desde la rejilla', ({ raw }) => {
    const chart = convertV1ToV2(raw, CREATED_AT)
    const song = parseSong(raw)
    for (const measure of song.measures) {
      for (const note of measure.notes) {
        const position = timeToMeasureBeat(chart.grid, note.absoluteTimeMs / 1000)
        expect(position.measure).toBe(measure.number)
        expect(position.beat).toBeCloseTo(note.beat + note.subdivision, 9)
      }
    }
  })

  it('ride_edge pasa a ride y los instrumentos desconocidos fallan', () => {
    const song = (instrument: string) => ({
      id: 'x',
      title: 'x',
      bpm: 120,
      measures: [{ number: 1, notes: [{ beat: 1, subdivision: 0, instrument, midi: 59 }] }],
    })
    expect(convertV1ToV2(song('ride_edge')).difficulties.full.notes[0].piece).toBe('ride')
    expect(() => convertV1ToV2(song('cowbell'))).toThrow(/instrumento desconocido "cowbell"/)
  })

  it('notas simultáneas se ordenan por pieza', () => {
    const chart = convertV1ToV2({
      id: 'x',
      title: 'x',
      bpm: 120,
      measures: [
        {
          number: 1,
          notes: [
            { beat: 1, subdivision: 0, instrument: 'hihat_closed', midi: 42 },
            { beat: 1, subdivision: 0, instrument: 'kick', midi: 36 },
          ],
        },
      ],
    })
    expect(chart.difficulties.full.notes.map(n => n.piece)).toEqual(['kick', 'hihat_closed'])
  })

  it('isChartV1 distingue v1 de v2', () => {
    const [{ raw }] = v1Songs
    expect(isChartV1(raw)).toBe(true)
    expect(isChartV1(convertV1ToV2(raw))).toBe(false)
    expect(isChartV1(null)).toBe(false)
  })
})

describe('public/songs (migradas a v2)', () => {
  it.each(v1Songs)('$name es exactamente la conversión del original v1', ({ name, raw }) => {
    const served = songFiles[`/public/songs/${name}`]
    expect(served).toEqual(convertV1ToV2(raw, CREATED_AT))
    expect(parseChart(served).version).toBe(2)
  })
})

describe('chartToSongData (puente al motor v1)', () => {
  it.each(v1Songs)('$name: ida y vuelta conserva compases, beats y tiempos', ({ raw }) => {
    const original = parseSong(raw)
    const back = chartToSongData(convertV1ToV2(raw, CREATED_AT))
    expect(back.measures).toHaveLength(original.measures.length)
    const key = (n: { absoluteTimeMs: number; instrument: string }) =>
      `${n.absoluteTimeMs}|${n.instrument}`
    const sortNotes = <T extends { absoluteTimeMs: number; instrument: string }>(notes: T[]) =>
      [...notes].sort((a, b) => key(a).localeCompare(key(b)))
    for (const [i, measure] of original.measures.entries()) {
      const got = sortNotes(back.measures[i].notes)
      const want = sortNotes(measure.notes)
      expect(got.map(n => n.instrument)).toEqual(want.map(n => n.instrument))
      got.forEach((n, j) => {
        expect(n.absoluteTimeMs).toBeCloseTo(want[j].absoluteTimeMs, 6)
        expect(n.beat).toBe(want[j].beat)
        expect(n.subdivision).toBeCloseTo(want[j].subdivision, 9)
      })
    }
  })

  it('usa las notas de la dificultad pedida', () => {
    const chart = convertV1ToV2(v1Songs[0].raw, CREATED_AT)
    for (const difficulty of DIFFICULTIES) {
      const notes = chartToSongData(chart, difficulty).measures.flatMap(m => m.notes)
      expect(notes).toHaveLength(chart.difficulties[difficulty].notes.length)
    }
  })
})

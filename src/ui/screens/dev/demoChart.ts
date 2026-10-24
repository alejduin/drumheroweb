import type { ChartNote, ChartV2, Piece } from '@/types'

const BEATS_PER_MEASURE = 4
const START_S = 2

/**
 * Chart sintético para la demo de la partitura (/dev/score) y la prueba de
 * rendimiento: groove con hi-hat o ride, ghost notes, acentos, hi-hat abierto,
 * golpe de aro y redobles de semicorcheas en los toms cada 4 compases.
 */
export function buildDemoChart(targetNotes = 2000, bpm = 104): ChartV2 {
  const beatS = 60 / bpm
  const notes: ChartNote[] = []
  let measure = 0

  const add = (beat: number, piece: Piece, velocity = 90) => {
    const t = START_S + (measure * BEATS_PER_MEASURE + beat) * beatS
    notes.push({ t: round(t), piece, velocity, confidence: 0.9 })
  }

  while (notes.length < targetNotes) {
    const fill = measure % 4 === 3
    const ride = Math.floor(measure / 8) % 2 === 1
    const lastBeat = fill ? 2 : 4

    for (let eighth = 0; eighth < lastBeat * 2; eighth++) {
      const beat = eighth / 2
      if (eighth === 0 && measure % 4 === 0) add(beat, 'crash', 110)
      else if (ride) add(beat, 'ride', eighth % 2 === 0 ? 100 : 80)
      else if (eighth === 7 && measure % 2 === 1) add(beat, 'hihat_open')
      else add(beat, 'hihat_closed', eighth % 2 === 0 ? 95 : 75)
    }
    if (ride) {
      add(1, 'hihat_pedal', 70)
      add(3, 'hihat_pedal', 70)
    }

    add(0, 'kick', 100)
    add(2, 'kick', 100)
    if (measure % 2 === 1) add(2.5, 'kick', 90)
    add(1, measure % 8 === 6 ? 'snare_rim' : 'snare', 100)
    add(1.75, 'snare', 35) // ghost
    if (!fill) {
      add(3, 'snare', measure % 4 === 2 ? 118 : 100) // acento
      add(3.25, 'snare', 35)
      if (measure % 2 === 0) add(1.5, 'kick', 85)
    } else {
      const toms: Piece[] = ['tom1', 'tom1', 'tom2', 'tom2', 'tom3', 'tom3', 'snare', 'snare']
      toms.forEach((piece, i) => add(2 + i / 4, piece, i === 6 ? 120 : 95))
      add(2, 'kick')
      add(3, 'kick')
    }
    measure++
  }

  notes.sort((a, b) => a.t - b.t)
  const measures = measure + 2
  const beats = Array.from({ length: measures * BEATS_PER_MEASURE }, (_, i) =>
    round(START_S + i * beatS),
  )
  const sectionNames = ['Intro', 'Verso 1', 'Coro 1', 'Verso 2', 'Coro 2', 'Puente', 'Coro final']
  const sections = Array.from({ length: Math.ceil(measure / 8) }, (_, i) => ({
    name: sectionNames[i % sectionNames.length],
    startMeasure: i * 8 + 1,
    endMeasure: Math.min(i * 8 + 8, measures),
  }))
  const track = { notes }

  return {
    version: 2,
    id: 'demo-score',
    title: 'Demo de partitura',
    artist: 'DrumHero',
    bpm,
    timeSignature: [4, 4],
    durationS: round(START_S + measures * BEATS_PER_MEASURE * beatS),
    audioUrl: null,
    stems: null,
    audioSha256: null,
    youtubeUrl: null,
    youtubeOffsetMs: 0,
    grid: { beats, downbeats: beats.filter((_, i) => i % BEATS_PER_MEASURE === 0) },
    difficulties: { basic: track, intermediate: track, full: track },
    sections,
    source: { kind: 'builtin', createdAt: '2026-10-24T00:00:00Z' },
  }
}

function round(t: number): number {
  return Math.round(t * 10000) / 10000
}

import { invertMidiMap, DEFAULT_MIDI_MAP } from '@/midi/midiMap'
import type { ChartV2, Difficulty, Measure, SongData } from '@/types'
import { measureCount, timeToMeasureBeat } from './grid'

// ─── Puente temporal chart v2 → motor v1 ──────────────────────────────────────
// El juego v1 (GameEngine, renderers, stores) sigue consumiendo SongData hasta
// que B5–B8 lo reemplacen. Se elimina junto con el motor v1.

const NOTE_FOR_PIECE = invertMidiMap(DEFAULT_MIDI_MAP)

const V1_DIFFICULTY: Record<Difficulty, SongData['difficulty']> = {
  basic: 'beginner',
  intermediate: 'intermediate',
  full: 'advanced',
}

export function chartToSongData(chart: ChartV2, difficulty: Difficulty = 'full'): SongData {
  const measures: Measure[] = Array.from({ length: measureCount(chart.grid) + 1 }, (_, i) => ({
    number: i,
    notes: [],
  }))

  for (const note of chart.difficulties[difficulty].notes) {
    const { measure, beat } = timeToMeasureBeat(chart.grid, note.t)
    const whole = Math.floor(beat + 1e-6)
    measures[measure].notes.push({
      beat: whole,
      subdivision: Math.max(0, beat - whole),
      instrument: note.piece,
      midi: NOTE_FOR_PIECE[note.piece] ?? 0,
      absoluteTimeMs: note.t * 1000,
    })
  }

  return {
    id: chart.id,
    title: chart.title,
    artist: chart.artist,
    difficulty: V1_DIFFICULTY[difficulty],
    bpm: chart.bpm,
    timeSignature: chart.timeSignature,
    youtubeUrl: chart.youtubeUrl,
    youtubeOffsetMs: chart.youtubeOffsetMs,
    // El compás 0 (anacrusa) solo se conserva si tiene notas
    measures: measures[0].notes.length > 0 ? measures : measures.slice(1),
    sections: chart.sections,
  }
}

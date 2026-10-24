import type { Piece } from './chart'

// ─── Formato de canción v1 ────────────────────────────────────────────────────
// Solo para convertir charts antiguos a v2 (chart/convertV1.ts). El juego usa ChartV2.

export interface NoteEvent {
  beat: number
  subdivision: number // 0=beat, 0.5=corchea, 0.25/0.75=semicorcheas
  instrument: Piece
  midi: number
  absoluteTimeMs: number // calculado por parseV1 al cargar
}

export interface Measure {
  number: number
  notes: NoteEvent[]
}

export interface Section {
  name: string
  startMeasure: number
  endMeasure: number
}

export interface SongData {
  id: string
  title: string
  artist: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  bpm: number
  timeSignature: [number, number]
  youtubeUrl: string | null
  youtubeOffsetMs: number
  measures: Measure[]
  sections: Section[]
}

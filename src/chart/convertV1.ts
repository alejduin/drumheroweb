import { parseSong } from '@/chart/parseV1'
import { PIECES } from '@/types'
import type { ChartNote, ChartV2, Piece } from '@/types'

// Los charts v1 no tienen velocity ni confianza: todas las notas quedan "normal" y seguras
export const V1_DEFAULT_VELOCITY = 90
const V1_CONFIDENCE = 1

const PIECE_ORDER = new Map<string, number>(PIECES.map((p, i) => [p, i]))

/** Instrumento v1 → pieza v2 (`ride_edge` pasa a `ride`, PLAN_V2 D5). */
function pieceFromV1(instrument: string): Piece {
  const piece = instrument === 'ride_edge' ? 'ride' : instrument
  if (!PIECE_ORDER.has(piece))
    throw new Error(`convertV1ToV2: instrumento desconocido "${instrument}"`)
  return piece as Piece
}

export function isChartV1(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    !('version' in raw) &&
    Array.isArray((raw as { measures?: unknown }).measures)
  )
}

/**
 * Convierte un chart v1 (compases + beats a BPM constante) a v2 (segundos).
 * Los tiempos son exactamente los que calculaba el motor v1 (positionToMs / 1000)
 * y la rejilla es sintética a BPM constante. Las notas van a `full`; basic e
 * intermediate quedan vacías y se generan en el cliente (PLAN_V2 D13).
 */
export function convertV1ToV2(raw: unknown, createdAt = new Date().toISOString()): ChartV2 {
  const song = parseSong(raw)
  const [beatsPerMeasure] = song.timeSignature
  const secondsPerBeat = 60 / song.bpm

  const lastNumbered = Math.max(0, ...song.measures.map(m => m.number))
  const lastSection = Math.max(0, ...song.sections.map(s => s.endMeasure))
  const measures = Math.max(song.measures.length, lastNumbered, lastSection)
  const totalBeats = measures * beatsPerMeasure

  const beats = Array.from({ length: totalBeats }, (_, i) => i * secondsPerBeat)
  const downbeats = beats.filter((_, i) => i % beatsPerMeasure === 0)

  const notes: ChartNote[] = song.measures
    .flatMap(m => m.notes)
    .map(n => ({
      t: n.absoluteTimeMs / 1000,
      piece: pieceFromV1(n.instrument),
      velocity: V1_DEFAULT_VELOCITY,
      confidence: V1_CONFIDENCE,
    }))
    .sort((a, b) => a.t - b.t || PIECE_ORDER.get(a.piece)! - PIECE_ORDER.get(b.piece)!)

  return {
    version: 2,
    id: song.id,
    title: song.title,
    artist: song.artist,
    bpm: song.bpm,
    timeSignature: song.timeSignature,
    durationS: totalBeats * secondsPerBeat,
    audioUrl: null,
    stems: null,
    audioSha256: null,
    youtubeUrl: song.youtubeUrl,
    youtubeOffsetMs: song.youtubeOffsetMs,
    grid: { beats, downbeats },
    difficulties: { basic: { notes: [] }, intermediate: { notes: [] }, full: { notes } },
    sections: song.sections,
    source: { kind: 'builtin', createdAt },
  }
}

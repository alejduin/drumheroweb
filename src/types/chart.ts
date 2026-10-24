// ─── Chart v2 ─────────────────────────────────────────────────────────────────
// Espejo TS de shared/chart-v2.schema.json. Un test de paridad verifica que
// los enums coinciden con el schema.

export const PIECES = [
  'kick',
  'snare',
  'snare_rim',
  'hihat_closed',
  'hihat_open',
  'hihat_pedal',
  'tom1',
  'tom2',
  'tom3',
  'crash',
  'ride',
] as const

export type Piece = (typeof PIECES)[number]

export const DYNAMICS = ['ghost', 'normal', 'accent'] as const

export type Dynamic = (typeof DYNAMICS)[number]

export const DIFFICULTIES = ['basic', 'intermediate', 'full'] as const

export type Difficulty = (typeof DIFFICULTIES)[number]

export const CHART_SOURCE_KINDS = ['ai', 'manual', 'builtin'] as const

export type ChartSourceKind = (typeof CHART_SOURCE_KINDS)[number]

export interface ChartNote {
  t: number // segundos desde el inicio del audio (fuente de verdad), cuantizado
  piece: Piece
  velocity: number // 1-127
  confidence: number // 0-1; < LOW_CONFIDENCE_THRESHOLD = por revisar
  dynamic?: Dynamic // si falta, se deriva de velocity
  tRaw?: number // onset sin cuantizar, para recuantizar en el editor
}

export interface NoteTrack {
  notes: ChartNote[]
}

export interface ChartGrid {
  beats: number[] // segundos, estrictamente ascendente
  downbeats: number[] // subconjunto de beats; el primero es el compás 1
}

export interface ChartSection {
  name: string
  startMeasure: number // base 1
  endMeasure: number // inclusivo
}

export interface ChartSource {
  kind: ChartSourceKind
  model?: string
  createdAt: string // ISO 8601
}

export interface ChartV2 {
  version: 2
  id: string
  title: string
  artist: string
  bpm: number // tempo medio; el tiempo real lo define grid
  timeSignature: [number, number]
  durationS: number
  audioUrl: string | null
  stems: { drums: string; backing: string } | null
  audioSha256: string | null
  youtubeUrl: string | null
  youtubeOffsetMs: number
  grid: ChartGrid
  difficulties: Record<Difficulty, NoteTrack>
  sections: ChartSection[]
  source: ChartSource
}

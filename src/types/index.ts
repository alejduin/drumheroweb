// ─── Instrumentos ────────────────────────────────────────────────────────────

export type DrumInstrument =
  | 'kick'
  | 'snare'
  | 'snare_rim'
  | 'hihat_closed'
  | 'hihat_open'
  | 'hihat_pedal'
  | 'tom1'
  | 'tom2'
  | 'crash'
  | 'ride'
  | 'ride_edge'

// ─── Precisión de hit ────────────────────────────────────────────────────────

export const HitAccuracy = {
  Perfect: 'perfect',
  Great: 'great',
  Good: 'good',
  Miss: 'miss',
} as const

export type HitAccuracy = (typeof HitAccuracy)[keyof typeof HitAccuracy]

// ─── MIDI ─────────────────────────────────────────────────────────────────────

export interface MidiHit {
  instrument: DrumInstrument
  midi: number
  velocity: number // 0-127
  timestamp: number // performance.now() en ms
}

// ─── Canciones ───────────────────────────────────────────────────────────────

export interface NoteEvent {
  beat: number
  subdivision: number // 0=beat, 0.5=corchea, 0.25/0.75=semicorcheas
  instrument: DrumInstrument
  midi: number
  absoluteTimeMs: number // calculado por SongParser al cargar
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

// ─── Engine ──────────────────────────────────────────────────────────────────

export interface HitResult {
  noteEvent: NoteEvent
  accuracy: HitAccuracy
  deltaMs: number // positivo = tarde, negativo = temprano
  points: number
}

// ─── Estado del juego (Zustand) ───────────────────────────────────────────────

export type GamePhase = 'idle' | 'playing' | 'paused' | 'results'

export interface GameState {
  phase: GamePhase
  song: SongData | null
  score: number
  combo: number
  multiplier: 1 | 2 | 3 | 4
  accuracy: Record<HitAccuracy, number> // conteo por tipo
  startedAt: number | null // performance.now()
}

// ─── Configuración ───────────────────────────────────────────────────────────

export interface UserSettings {
  midiDeviceId: string | null
  midiLatencyOffsetMs: number
  midiMap: Record<number, DrumInstrument> // nota MIDI → instrumento
  metronomeVolume: number // 0-1
  sampleVolume: number // 0-1
  scrollSpeed: number // multiplicador sobre la velocidad base
}

// ─── Chart v2 ─────────────────────────────────────────────────────────────────

export * from './chart'
export * from './api'

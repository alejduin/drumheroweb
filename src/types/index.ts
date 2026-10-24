import type { Piece } from './chart'

// ─── MIDI ─────────────────────────────────────────────────────────────────────

export interface MidiHit {
  instrument: Piece
  midi: number
  velocity: number // 0-127
  timestamp: number // performance.now() en ms
}

// ─── Partitura ────────────────────────────────────────────────────────────────

export const SCORE_VIEWS = ['staff', 'lanes'] as const

/** Pentagrama o Carriles (PLAN_V2 §4.3). */
export type ScoreView = (typeof SCORE_VIEWS)[number]

export * from './chart'
export * from './api'
export * from './reference'
export * from './scoring'
export * from './v1'

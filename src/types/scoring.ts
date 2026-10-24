import type { Piece } from './chart'

// ─── Nivel y juicios (REQUIREMENTS_V2 §6.5) ───────────────────────────────────
// Nivel = ventanas de acierto (Settings). Es independiente de la dificultad del
// chart (qué notas hay), ver PLAN_V2 D1.

export const LEVELS = ['beginner', 'intermediate', 'expert'] as const

export type Level = (typeof LEVELS)[number]

/**
 * perfect / close / miss cuentan en la precisión; wrong_pad es solo feedback
 * gris (no rompe el combo ni cuenta, PLAN_V2 D2).
 */
export const JUDGEMENTS = ['perfect', 'close', 'miss', 'wrong_pad'] as const

export type Judgement = (typeof JUDGEMENTS)[number]

// ─── Resultado de evaluar un golpe ────────────────────────────────────────────

/** Signo del golpe respecto de la nota: temprano (delta < 0) o tarde (delta > 0). */
export type Timing = 'early' | 'on_time' | 'late'

/** Golpe MIDI ya convertido a segundos de canción con clock.perfToSong(). */
export interface PlayedHit {
  t: number
  piece: Piece
  velocity: number // 1-127
}

/** Golpe que acertó una nota (Perfecto o Cerca). */
export interface NoteHitJudgement {
  judgement: 'perfect' | 'close'
  noteIndex: number // índice en las notas de la dificultad
  piece: Piece
  deltaMs: number // golpe − nota, ya restada la latencia del kit; < 0 = temprano
  timing: Timing
  points: number // base del nivel, sin multiplicador de combo
  dynamicBonus: number // 0 o DYNAMIC_BONUS_POINTS
  velocity: number
}

/** Nota que expiró sin golpe. Rompe el combo. */
export interface MissJudgement {
  judgement: 'miss'
  noteIndex: number
  piece: Piece
}

/**
 * Golpe que no acertó ninguna nota: solo feedback gris. `expectedPiece` es la pieza
 * de la nota pendiente más cercana dentro de la ventana, si la había (confusión de pad).
 */
export interface WrongPadJudgement {
  judgement: 'wrong_pad'
  piece: Piece
  expectedPiece: Piece | null
  velocity: number
}

export type HitJudgement = NoteHitJudgement | WrongPadJudgement
export type JudgementEvent = HitJudgement | MissJudgement

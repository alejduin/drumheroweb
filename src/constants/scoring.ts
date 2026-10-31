import type { Level } from '@/types'

// ─── Ventanas de acierto por nivel (REQUIREMENTS_V2 §6.5) ─────────────────────
// Límites inclusivos: |delta| <= perfectMs es Perfecto; <= closeMs es Cerca.

export interface HitWindows {
  perfectMs: number
  closeMs: number
}

export const LEVEL_WINDOWS: Readonly<Record<Level, HitWindows>> = {
  beginner: { perfectMs: 45, closeMs: 110 },
  intermediate: { perfectMs: 30, closeMs: 80 },
  expert: { perfectMs: 20, closeMs: 50 },
}

// ─── Puntos por juicio ────────────────────────────────────────────────────────

export interface JudgementPoints {
  perfect: number
  close: number
}

export const LEVEL_POINTS: Readonly<Record<Level, JudgementPoints>> = {
  beginner: { perfect: 100, close: 50 },
  intermediate: { perfect: 100, close: 50 },
  expert: { perfect: 100, close: 40 },
}

export const DEFAULT_LEVEL: Level = 'intermediate'

// ─── Dinámica (PLAN_V2 D3) ───────────────────────────────────────────────────

// +10 si una ghost se toca con velocity < 50 o un acento con velocity > 100
export const DYNAMIC_BONUS_POINTS = 10

// Mismos umbrales que el worker (dynamics.py): < 50 ghost, > 100 acento
export const GHOST_MAX_VELOCITY = 50
export const ACCENT_MIN_VELOCITY = 100

// ─── Combo (REQUIREMENTS_V2 §6.5) ─────────────────────────────────────────────
// x1 (0–9), x2 (10–24), x3 (25–49), x4 (50+). El golpe que lleva el combo a 10
// ya suma con x2.

export const COMBO_MULTIPLIERS = [
  { minCombo: 50, multiplier: 4 },
  { minCombo: 25, multiplier: 3 },
  { minCombo: 10, multiplier: 2 },
  { minCombo: 0, multiplier: 1 },
] as const

export type Multiplier = (typeof COMBO_MULTIPLIERS)[number]['multiplier']

export function multiplierFor(combo: number): Multiplier {
  return COMBO_MULTIPLIERS.find(tier => combo >= tier.minCombo)?.multiplier ?? 1
}

// ─── Timing ───────────────────────────────────────────────────────────────────

// Golpes que promedia la tendencia temprano/tarde (medidor de timing)
export const TIMING_TREND_HITS = 16

// ─── Precisión (PLAN_V2 D11, D18) ─────────────────────────────────────────────

// Color por umbral de precisión (secciones y compases): verde ≥ 85 %, ámbar ≥ 72 %, rojo
export const PRECISION_GOOD = 0.85
export const PRECISION_OK = 0.72

export type PrecisionTone = 'perfect' | 'close' | 'miss'

export function precisionTone(precision: number): PrecisionTone {
  if (precision >= PRECISION_GOOD) return 'perfect'
  if (precision >= PRECISION_OK) return 'close'
  return 'miss'
}

// Precisión mínima para cada estrella (1 a 5); 91 % = 4 estrellas, como la maqueta de Resultados
export const STAR_THRESHOLDS = [0.4, 0.6, 0.75, 0.9, 0.99] as const

export type Stars = 0 | 1 | 2 | 3 | 4 | 5

export function starsFor(precision: number | null): Stars {
  if (precision === null) return 0
  return STAR_THRESHOLDS.filter(min => precision >= min).length as Stars
}

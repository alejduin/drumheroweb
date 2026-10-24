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

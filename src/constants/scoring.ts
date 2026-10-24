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

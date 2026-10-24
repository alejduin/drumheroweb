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

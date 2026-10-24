import { LOW_CONFIDENCE_THRESHOLD } from '@/constants/chart'
import { ACCENT_MIN_VELOCITY, GHOST_MAX_VELOCITY } from '@/constants/scoring'
import type { ChartNote, Dynamic } from '@/types'

/** Dinámica a partir de la velocity, con los mismos umbrales que el worker. */
export function dynamicForVelocity(velocity: number): Dynamic {
  if (velocity < GHOST_MAX_VELOCITY) return 'ghost'
  if (velocity > ACCENT_MIN_VELOCITY) return 'accent'
  return 'normal'
}

/** Dinámica de la nota: la explícita del chart o la derivada de su velocity. */
export function noteDynamic(note: ChartNote): Dynamic {
  return note.dynamic ?? dynamicForVelocity(note.velocity)
}

export function needsReview(note: ChartNote): boolean {
  return note.confidence < LOW_CONFIDENCE_THRESHOLD
}

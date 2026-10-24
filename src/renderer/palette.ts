import { THEME_COLORS } from '@/constants/theme'
import type { NoteVisualState } from './noteStates'

/** Color de una nota según su estado (futuro, Perfecto, Cerca, Fallo). */
export const STATE_COLORS: Record<NoteVisualState, string> = {
  future: THEME_COLORS['paper-future'],
  perfect: THEME_COLORS.perfect,
  close: THEME_COLORS.close,
  miss: THEME_COLORS.miss,
}

/** Mismo color con opacidad (los tokens son #rrggbb). */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
  return `${hex}${a.toString(16).padStart(2, '0')}`
}

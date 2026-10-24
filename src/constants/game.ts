import type { DrumInstrument, HitAccuracy } from '@/types'

// ─── Ventanas de precisión (ms) ──────────────────────────────────────────────

export const PERFECT_WINDOW_MS = 30
export const GREAT_WINDOW_MS = 60
export const GOOD_WINDOW_MS = 100

// ─── Puntos por precisión ────────────────────────────────────────────────────

export const POINTS: Record<HitAccuracy, number> = {
  perfect: 100,
  great: 75,
  good: 50,
  miss: 0,
}

// ─── Sistema de combo ────────────────────────────────────────────────────────

// Hits consecutivos necesarios para subir al siguiente multiplicador
export const COMBO_THRESHOLDS = [0, 10, 25, 50] as const

export const MULTIPLIERS = [1, 2, 3, 4] as const

export function getMultiplier(combo: number): 1 | 2 | 3 | 4 {
  if (combo >= 50) return 4
  if (combo >= 25) return 3
  if (combo >= 10) return 2
  return 1
}

// ─── Sistema de estrellas (resultados) ───────────────────────────────────────

// Porcentaje mínimo de notas acertadas para cada estrella
export const STAR_THRESHOLDS = [0, 0.4, 0.6, 0.75, 0.9, 0.99] as const

export function getStars(hitRatio: number): 0 | 1 | 2 | 3 | 4 | 5 {
  for (let i = STAR_THRESHOLDS.length - 1; i >= 0; i--) {
    if (hitRatio >= STAR_THRESHOLDS[i]) return i as 0 | 1 | 2 | 3 | 4 | 5
  }
  return 0
}

// ─── Canvas / Renderer ───────────────────────────────────────────────────────

// Posición horizontal de la línea de timing (ratio sobre el ancho total)
export const TIMING_LINE_X_RATIO = 0.2

// Velocidad base de scroll en px por ms
export const BASE_SCROLL_SPEED_PX_PER_MS = 0.35

// FPS objetivo
export const TARGET_FPS = 60

// Altura de cada carril en px
export const LANE_HEIGHT_PX = 60

// ─── Carriles (orden visual de arriba a abajo) ────────────────────────────────

export const LANES: DrumInstrument[] = [
  'crash',
  'ride',
  'hihat_closed',
  'hihat_open',
  'snare',
  'tom1',
  'tom2',
  'kick',
]

// ─── Colores por instrumento ─────────────────────────────────────────────────

export const INSTRUMENT_COLORS: Record<DrumInstrument, string> = {
  kick: '#ef4444',
  snare: '#3b82f6',
  snare_rim: '#60a5fa',
  hihat_closed: '#facc15',
  hihat_open: '#fde68a',
  hihat_pedal: '#fbbf24',
  tom1: '#a855f7',
  tom2: '#c084fc',
  crash: '#22c55e',
  ride: '#4ade80',
  ride_edge: '#86efac',
}

// ─── Colores de feedback por precisión ───────────────────────────────────────

export const ACCURACY_COLORS: Record<HitAccuracy, string> = {
  perfect: '#ffd700',
  great: '#22c55e',
  good: '#facc15',
  miss: '#ef4444',
}

// ─── MIDI ─────────────────────────────────────────────────────────────────────

// Canal MIDI de batería Roland (canal 10, index 9)
export const MIDI_DRUM_CHANNEL = 9

// Status byte de noteOn en canal 10
export const MIDI_NOTE_ON_STATUS = 0x99

// Velocidad mínima para considerar un golpe válido (filtrar fantasmas)
export const MIN_VELOCITY = 5

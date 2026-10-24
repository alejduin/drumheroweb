// ─── Chart v2 ─────────────────────────────────────────────────────────────────

// Notas con confianza por debajo de este umbral se marcan "por revisar" en el editor
export const LOW_CONFIDENCE_THRESHOLD = 0.6

// Tolerancia al comparar tiempos en segundos (redondeo a 4 decimales en el worker)
export const TIME_EPSILON_S = 0.0005

// Duración máxima de audio aceptada para análisis (10 minutos)
export const MAX_AUDIO_DURATION_S = 600

// ─── Sincronía del video de YouTube con el reloj del MP3 (PLAN_V2 C1) ─────────
// El MP3 es el único reloj. El video va silenciado y lo sigue: tiempo de video =
// tiempo de canción + youtubeOffsetMs / 1000 (offset > 0 = el video va adelantado,
// p. ej. tiene una intro que el MP3 no tiene).

/** Deriva a partir de la cual se corrige con seekTo (REQUIREMENTS_V2 §6.4). */
export const DRIFT_CORRECT_MS = 40

/** Frames seguidos por encima del umbral antes de corregir (filtra picos sueltos). */
export const DRIFT_CONFIRM_FRAMES = 3

/** Tras un seekTo el video tarda en asentarse: no se vuelve a corregir hasta pasado esto. */
export const CORRECTION_COOLDOWN_MS = 1000

export type VideoState = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued'

/** YT.PlayerState → estado propio (-1, 0, 1, 2, 3, 5). */
export function mapPlayerState(state: number): VideoState {
  switch (state) {
    case 0:
      return 'ended'
    case 1:
      return 'playing'
    case 2:
      return 'paused'
    case 3:
      return 'buffering'
    case 5:
      return 'cued'
    default:
      return 'unstarted'
  }
}

/** Segundo del video que corresponde a un segundo de la canción. */
export function videoTimeFor(songS: number, offsetMs: number): number {
  return songS + offsetMs / 1000
}

/** Deriva en ms: > 0 = el video va por delante de donde debería. */
export function computeDrift(videoS: number, songS: number, offsetMs: number): number {
  return (videoS - videoTimeFor(songS, offsetMs)) * 1000
}

/**
 * getCurrentTime() de YouTube avanza a saltos (se actualiza cada pocos cientos de ms).
 * Entre saltos se interpola con performance.now() y la velocidad del video; cada
 * valor nuevo re-ancla la estimación.
 */
export class VideoTimeEstimator {
  private raw = NaN
  private anchorS = 0
  private anchorPerfMs = 0

  /** Estimación del tiempo real del video en `perfMs`. */
  sample(rawS: number, perfMs: number, playing: boolean, rate: number): number {
    if (rawS !== this.raw || !playing) {
      this.raw = rawS
      this.anchorS = rawS
      this.anchorPerfMs = perfMs
      return rawS
    }
    return this.anchorS + ((perfMs - this.anchorPerfMs) / 1000) * rate
  }

  /** Tras un seekTo el próximo valor crudo es un ancla nueva. */
  reset(): void {
    this.raw = NaN
  }
}

/**
 * Decide cuándo corregir: la deriva tiene que superar el umbral DRIFT_CONFIRM_FRAMES
 * frames seguidos y haber pasado el enfriamiento desde la última corrección.
 */
export class DriftCorrector {
  private over = 0
  private lastCorrectionMs = -Infinity

  shouldCorrect(driftMs: number, perfMs: number): boolean {
    if (perfMs - this.lastCorrectionMs < CORRECTION_COOLDOWN_MS) {
      this.over = 0
      return false
    }
    this.over = Math.abs(driftMs) > DRIFT_CORRECT_MS ? this.over + 1 : 0
    if (this.over < DRIFT_CONFIRM_FRAMES) return false
    this.over = 0
    this.lastCorrectionMs = perfMs
    return true
  }

  /** Corrección forzada (seek o play del reloj): cuenta para el enfriamiento. */
  corrected(perfMs: number): void {
    this.over = 0
    this.lastCorrectionMs = perfMs
  }
}

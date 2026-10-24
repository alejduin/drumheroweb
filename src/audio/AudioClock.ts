// ─── Reloj maestro ────────────────────────────────────────────────────────────
// La posición de reproducción del audio es el único reloj del juego (PLAN_V2 §1.1).
// Partitura, metrónomo, video y evaluación de golpes leen este reloj.

export interface SongClock {
  /** Posición actual de la canción en segundos (lo que se está oyendo). */
  now(): number
  /** Convierte un timestamp performance.now() (p. ej. MIDIMessageEvent.timeStamp) a segundos de canción. */
  perfToSong(perfMs: number): number
  readonly playbackRate: number
  readonly isPlaying: boolean
}

/** Lo mínimo que el reloj necesita del AudioContext (permite un fake en tests). */
export interface ClockContext {
  readonly currentTime: number
  readonly outputLatency?: number
  readonly baseLatency?: number
  getOutputTimestamp?(): AudioTimestamp
}

/**
 * AudioClock — traduce el tiempo del AudioContext a segundos de canción.
 *
 * Quien reproduce el audio (BufferPlayer, StemPlayer) avisa con `start()` en qué
 * instante del contexto empieza a sonar qué posición de la canción, y con
 * `pause()` cuándo se detiene. El reloj no reproduce nada por sí mismo.
 *
 * "Lo que se está oyendo" se calcula con getOutputTimestamp() (par contextTime /
 * performanceTime del audio que sale por el DAC). Si el navegador no lo da, se
 * usa currentTime - outputLatency.
 */
export class AudioClock implements SongClock {
  private anchorCtx = 0
  private anchorSong = 0
  private rate = 1
  private playing = false
  private lastNow = 0

  private readonly ctx: ClockContext
  private readonly perfNow: () => number

  constructor(ctx: ClockContext, perfNow: () => number = () => performance.now()) {
    this.ctx = ctx
    this.perfNow = perfNow
  }

  get playbackRate(): number {
    return this.rate
  }

  get isPlaying(): boolean {
    return this.playing
  }

  /** La posición `songOffset` de la canción empieza a sonar en `ctxTime` (tiempo del contexto). */
  start(ctxTime: number, songOffset: number, rate = 1): void {
    this.anchorCtx = ctxTime
    this.anchorSong = songOffset
    this.rate = rate
    this.playing = true
    this.lastNow = -Infinity
  }

  /**
   * Detiene el reloj en la posición programada en ctx.currentTime (la que el
   * reproductor usará para reanudar). Retorna esa posición.
   */
  pause(): number {
    if (this.playing) {
      this.anchorSong = this.ctxToSong(this.ctx.currentTime)
      this.playing = false
    }
    return this.anchorSong
  }

  /** Mueve la posición con el reloj detenido. */
  seek(songTime: number): void {
    this.anchorSong = songTime
    this.lastNow = -Infinity
  }

  now(): number {
    if (!this.playing) return this.anchorSong
    // La interpolación de getOutputTimestamp puede retroceder unos µs entre llamadas
    const t = Math.max(this.perfToSong(this.perfNow()), this.lastNow)
    this.lastNow = t
    return t
  }

  perfToSong(perfMs: number): number {
    if (!this.playing) return this.anchorSong
    return this.ctxToSong(this.audibleCtxTime(perfMs))
  }

  /** Latencia de salida estimada en segundos (para mostrar y registrar). */
  outputLatencyS(): number {
    return this.ctx.outputLatency ?? this.ctx.baseLatency ?? 0
  }

  /** Tiempo del contexto del audio que se oye en el instante `perfMs`. */
  private audibleCtxTime(perfMs: number): number {
    const ts = this.ctx.getOutputTimestamp?.()
    if (
      ts &&
      ts.performanceTime !== undefined &&
      ts.contextTime !== undefined &&
      ts.performanceTime > 0
    ) {
      return ts.contextTime + (perfMs - ts.performanceTime) / 1000
    }
    const sinceNow = (perfMs - this.perfNow()) / 1000
    return this.ctx.currentTime - this.outputLatencyS() + sinceNow
  }

  private ctxToSong(ctxTime: number): number {
    return (ctxTime - this.anchorCtx) * this.rate + this.anchorSong
  }
}

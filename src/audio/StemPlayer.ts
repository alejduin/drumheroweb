import { AudioClock } from './AudioClock'
import type { ClockContext } from './AudioClock'
import type { Mixer } from './Mixer'
import type { SongAudio } from './loadSongAudio'

/** Margen para programar el arranque: todas las fuentes empiezan en el mismo instante exacto. */
export const START_LEAD_S = 0.05

/** Subconjunto de AudioContext que usa el reproductor (fake en tests). */
export interface PlayerContext extends ClockContext {
  readonly destination: AudioNode
  createBufferSource(): AudioBufferSourceNode
}

export interface StemTrack {
  buffer: AudioBuffer
  /** Nodo de salida (entrada del canal del Mixer, o ctx.destination). */
  output: AudioNode
}

/**
 * StemPlayer — reproduce varios AudioBuffer (stems de batería y backing, o solo el
 * MP3 original) arrancados con el mismo `when`, así que suenan alineados a la muestra.
 * Mantiene el AudioClock al día: es el reloj maestro de la partida.
 *
 * Play / pausa / seek / velocidad. Cada play crea fuentes nuevas (un
 * AudioBufferSourceNode no se puede reiniciar).
 */
export class StemPlayer {
  readonly clock: AudioClock
  readonly durationS: number
  private sources: AudioBufferSourceNode[] = []
  private rate = 1
  private onEndedCallback: (() => void) | null = null

  private readonly ctx: PlayerContext
  private readonly tracks: readonly StemTrack[]

  constructor(ctx: PlayerContext, tracks: readonly StemTrack[], perfNow?: () => number) {
    if (tracks.length === 0) throw new Error('StemPlayer: hace falta al menos una pista')
    this.ctx = ctx
    this.tracks = tracks
    this.durationS = Math.max(...tracks.map(t => t.buffer.duration))
    this.clock = new AudioClock(ctx, perfNow)
  }

  get isPlaying(): boolean {
    return this.clock.isPlaying
  }

  get playbackRate(): number {
    return this.rate
  }

  onEnded(callback: (() => void) | null): void {
    this.onEndedCallback = callback
  }

  play(): void {
    if (this.clock.isPlaying) return
    const offset = this.clamp(this.clock.now())
    if (offset >= this.durationS) return

    const when = this.ctx.currentTime + START_LEAD_S
    const sources: AudioBufferSourceNode[] = []
    for (const track of this.tracks) {
      // Un stem más corto que la posición no tiene nada que sonar
      if (offset >= track.buffer.duration) continue
      const source = this.ctx.createBufferSource()
      source.buffer = track.buffer
      source.playbackRate.value = this.rate
      source.connect(track.output)
      source.start(when, offset)
      sources.push(source)
    }
    // El fin natural lo marca la pista más larga
    const longest = sources.reduce((a, b) => (b.buffer!.duration > a.buffer!.duration ? b : a))
    longest.onended = () => {
      // Solo el fin natural; un stop() por pausa/seek ya quitó las fuentes
      if (this.sources !== sources) return
      this.disconnect(sources)
      this.sources = []
      this.clock.pause()
      this.clock.seek(this.durationS)
      this.onEndedCallback?.()
    }
    this.sources = sources
    this.clock.start(when, offset, this.rate)
  }

  pause(): void {
    if (!this.clock.isPlaying) return
    const position = this.clock.pause()
    this.stopSources()
    this.clock.seek(this.clamp(position))
  }

  seek(songTime: number): void {
    this.restart(() => this.clock.seek(this.clamp(songTime)))
  }

  /**
   * Velocidad de reproducción (1 = normal). Por ahora cambia también el tono;
   * el time-stretch sin cambio de tono llega en D2. El reloj escala con el rate.
   */
  setPlaybackRate(rate: number): void {
    if (!(rate > 0)) throw new RangeError(`playbackRate inválido: ${rate}`)
    this.restart(() => {
      this.rate = rate
    })
  }

  dispose(): void {
    this.onEndedCallback = null
    this.pause()
  }

  /** Detiene, aplica el cambio y reanuda en la misma posición si estaba sonando. */
  private restart(change: () => void): void {
    const wasPlaying = this.clock.isPlaying
    if (wasPlaying) {
      this.clock.seek(this.clamp(this.clock.pause()))
      this.stopSources()
    }
    change()
    if (wasPlaying) this.play()
  }

  private clamp(t: number): number {
    return Math.min(Math.max(t, 0), this.durationS)
  }

  private stopSources(): void {
    const sources = this.sources
    this.sources = []
    for (const source of sources) {
      source.onended = null
      source.stop()
    }
    this.disconnect(sources)
  }

  private disconnect(sources: readonly AudioBufferSourceNode[]): void {
    for (const source of sources) source.disconnect()
  }
}

/** Reproductor de una canción cargada, con cada pista en su canal del mezclador. */
export function createSongPlayer(
  ctx: PlayerContext,
  audio: SongAudio,
  mixer: Mixer,
  perfNow?: () => number,
): StemPlayer {
  const tracks = audio.tracks.map(t => ({ buffer: t.buffer, output: mixer.input(t.channel) }))
  return new StemPlayer(ctx, tracks, perfNow)
}

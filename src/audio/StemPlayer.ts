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

/** Pistas estiradas a otro tempo: cubren [startS, endS) en segundos de canción. */
export interface StretchedTracks {
  buffers: readonly AudioBuffer[]
  startS: number
  endS: number
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
  /** Pistas ya estiradas a `rate` (mismo orden que tracks); null = las originales. */
  private stretched: StretchedTracks | null = null
  /** Posición desde la que arrancó el último play (sin contar la cuenta previa). */
  private playOffset = 0
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

  /**
   * Arranca desde la posición del reloj. `leadS` (segundos de canción) retrasa el
   * audio para una cuenta previa: el reloj corre esos segundos antes de `offset`
   * sin que suene nada, así los clicks de la cuenta caen en el mismo reloj.
   */
  play(leadS = 0): void {
    if (this.clock.isPlaying) return
    const offset = this.clamp(this.clock.now())
    if (offset >= this.durationS) return

    const when = this.ctx.currentTime + START_LEAD_S + Math.max(leadS, 0) / this.rate
    // Las pistas estiradas sirven si el arranque cae en el tramo que cubren
    const region =
      this.stretched && offset >= this.stretched.startS && offset < this.stretched.endS
        ? this.stretched
        : null
    const sources: AudioBufferSourceNode[] = []
    let longest: AudioBufferSourceNode | null = null
    let longestS = -1
    for (const [i, track] of this.tracks.entries()) {
      // Un stem más corto que la posición no tiene nada que sonar
      if (offset >= track.buffer.duration) continue
      const source = this.ctx.createBufferSource()
      if (region) {
        // Ya está a otro tempo: suena a velocidad normal desde la posición equivalente
        source.buffer = region.buffers[i]
        source.playbackRate.value = 1
        source.connect(track.output)
        source.start(when, (offset - region.startS) / this.rate)
      } else {
        source.buffer = track.buffer
        source.playbackRate.value = this.rate
        source.connect(track.output)
        source.start(when, offset)
      }
      sources.push(source)
      // El fin natural lo marca la pista más larga
      if (track.buffer.duration > longestS) {
        longestS = track.buffer.duration
        longest = source
      }
    }
    if (!longest) return
    longest.onended = () => {
      // Solo el fin natural; un stop() por pausa/seek ya quitó las fuentes
      if (this.sources !== sources) return
      this.disconnect(sources)
      this.sources = []
      // Fin del tramo estirado antes del final: sigue con las originales (cambia el
      // tono) hasta que lleguen las pistas estiradas completas
      if (region && region.endS < this.durationS - 0.01) {
        this.clock.pause()
        this.clock.seek(region.endS)
        this.play()
        return
      }
      this.clock.pause()
      this.clock.seek(this.durationS)
      this.onEndedCallback?.()
    }
    this.sources = sources
    this.playOffset = offset
    this.clock.start(when, offset, this.rate)
  }

  pause(): void {
    if (!this.clock.isPlaying) return
    // Pausar durante la cuenta previa no retrocede: se reanuda desde donde iba a sonar
    const position = Math.max(this.clock.pause(), this.playOffset)
    this.stopSources()
    this.clock.seek(this.clamp(position))
  }

  seek(songTime: number): void {
    this.restart(() => this.clock.seek(this.clamp(songTime)))
  }

  /**
   * Velocidad cambiando también el tono (playbackRate de cada fuente). Sirve para
   * la pista silenciosa de los charts sin audio; con música, setTempo.
   */
  setPlaybackRate(rate: number): void {
    this.setTempo(rate, null)
  }

  /**
   * Tempo sin cambio de tono (PLAN_V2 D2): `stretched` son las pistas ya estiradas
   * a `rate` (stretchBuffers), una por pista y en orden, para un tramo de la canción
   * o para toda; null = las originales con playbackRate. Fuera del tramo suenan las
   * originales con playbackRate. El reloj escala con el rate, así todo lo demás
   * sigue en segundos de canción. Si estaba sonando, sigue desde la misma posición.
   */
  setTempo(rate: number, stretched: StretchedTracks | null): void {
    if (!(rate > 0)) throw new RangeError(`playbackRate inválido: ${rate}`)
    if (stretched && stretched.buffers.length !== this.tracks.length) {
      throw new Error('setTempo: hace falta un buffer estirado por pista')
    }
    this.restart(() => {
      this.rate = rate
      this.stretched = rate === 1 ? null : stretched
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
      this.clock.seek(this.clamp(Math.max(this.clock.pause(), this.playOffset)))
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

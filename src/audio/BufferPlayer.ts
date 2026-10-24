import { AudioClock } from './AudioClock'
import type { ClockContext } from './AudioClock'

/** Margen para programar el arranque: todas las fuentes empiezan en el mismo instante exacto. */
export const START_LEAD_S = 0.05

/** Subconjunto de AudioContext que usa el reproductor (fake en tests). */
export interface PlayerContext extends ClockContext {
  readonly destination: AudioNode
  createBufferSource(): AudioBufferSourceNode
}

/**
 * BufferPlayer — reproduce un AudioBuffer y mantiene el AudioClock al día.
 * Play / pausa / seek. (B4 lo generaliza a varios stems en StemPlayer.)
 */
export class BufferPlayer {
  readonly clock: AudioClock
  private source: AudioBufferSourceNode | null = null
  private onEndedCallback: (() => void) | null = null

  private readonly ctx: PlayerContext
  private readonly buffer: AudioBuffer

  constructor(ctx: PlayerContext, buffer: AudioBuffer, perfNow?: () => number) {
    this.ctx = ctx
    this.buffer = buffer
    this.clock = new AudioClock(ctx, perfNow)
  }

  get durationS(): number {
    return this.buffer.duration
  }

  get isPlaying(): boolean {
    return this.clock.isPlaying
  }

  onEnded(callback: (() => void) | null): void {
    this.onEndedCallback = callback
  }

  play(): void {
    if (this.clock.isPlaying) return
    const offset = Math.min(Math.max(this.clock.now(), 0), this.buffer.duration)
    if (offset >= this.buffer.duration) return

    const source = this.ctx.createBufferSource()
    source.buffer = this.buffer
    source.connect(this.ctx.destination)
    source.onended = () => {
      // Solo el fin natural; un stop() por pausa/seek ya desconectó la fuente
      if (this.source !== source) return
      this.source = null
      this.clock.pause()
      this.clock.seek(this.buffer.duration)
      this.onEndedCallback?.()
    }
    const when = this.ctx.currentTime + START_LEAD_S
    source.start(when, offset)
    this.source = source
    this.clock.start(when, offset)
  }

  pause(): void {
    if (!this.clock.isPlaying) return
    const position = this.clock.pause()
    this.stopSource()
    this.clock.seek(Math.min(Math.max(position, 0), this.buffer.duration))
  }

  seek(songTime: number): void {
    const wasPlaying = this.clock.isPlaying
    if (wasPlaying) {
      this.clock.pause()
      this.stopSource()
    }
    this.clock.seek(Math.min(Math.max(songTime, 0), this.buffer.duration))
    if (wasPlaying) this.play()
  }

  dispose(): void {
    this.onEndedCallback = null
    this.pause()
  }

  private stopSource(): void {
    const source = this.source
    this.source = null
    if (!source) return
    source.onended = null
    source.stop()
    source.disconnect()
  }
}

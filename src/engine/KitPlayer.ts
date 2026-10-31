import type { ChartNote } from '@/types'
import type { KitBuffers } from '@/audio/drumSynth'
import { LOOKAHEAD_S } from './Metronome'
import type { MetronomeClock } from './Metronome'
import { rafScheduler } from './GameEngine'
import type { FrameScheduler } from './GameEngine'

// ─── "Escuchar la transcripción" (PLAN_V2 C4) ────────────────────────────────
// Toca las notas del chart con los sonidos del kit, agendadas en el AudioContext
// sobre el reloj maestro. Mismo esquema que el Metrónomo: RAF + lookahead, y al
// reanclarse el reloj (pausa, seek, velocidad) cancela lo agendado y sigue.

/** Ganancia de una nota según su velocity (curva suave: los ghost se oyen, poco). */
export function velocityGain(velocity: number): number {
  const v = Math.min(Math.max(velocity, 1), 127) / 127
  return v * v * 0.8 + 0.2 * v
}

/** Primer índice con notes[i].t >= x (notes ordenadas por t). */
function lowerBound(notes: readonly ChartNote[], x: number): number {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (notes[mid].t < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Índices de las notas con from <= t < to, en orden (notes ordenadas por t). */
export function notesInWindow(notes: readonly ChartNote[], from: number, to: number): number[] {
  const result: number[] = []
  for (let i = lowerBound(notes, from); i < notes.length && notes[i].t < to; i++) result.push(i)
  return result
}

/** Subconjunto de AudioContext que usa el reproductor (fake en tests). */
export interface KitPlayerContext {
  readonly currentTime: number
  createBufferSource(): AudioBufferSourceNode
  createGain(): GainNode
}

export interface KitPlayerDeps {
  ctx: KitPlayerContext
  clock: MetronomeClock
  buffers: KitBuffers
  /** Notas a tocar, ordenadas por t. */
  notes: readonly ChartNote[]
  /** Canal "samples" del Mixer: el volumen se controla ahí. */
  output: AudioNode
  scheduler?: FrameScheduler
}

interface ScheduledHit {
  source: AudioBufferSourceNode
  gain: GainNode
  endCtx: number
}

export class KitPlayer {
  private readonly ctx: KitPlayerContext
  private readonly clock: MetronomeClock
  private readonly buffers: KitBuffers
  private readonly output: AudioNode
  private readonly scheduler: FrameScheduler
  private notes: readonly ChartNote[]

  private epoch = -1
  /** Siguiente instante de canción por agendar. */
  private cursor = 0
  private scheduled: ScheduledHit[] = []
  private frameId: number | null = null

  constructor({ ctx, clock, buffers, notes, output, scheduler = rafScheduler }: KitPlayerDeps) {
    this.ctx = ctx
    this.clock = clock
    this.buffers = buffers
    this.notes = notes
    this.output = output
    this.scheduler = scheduler
  }

  /**
   * Cambia las notas (el editor, al editar). Lo ya agendado suena igual; las
   * notas nuevas por delante del cursor entran en el siguiente tick.
   */
  setNotes(notes: readonly ChartNote[]): void {
    this.notes = notes
  }

  start(): void {
    if (this.frameId !== null) return
    const frame = () => {
      this.frameId = this.scheduler.request(frame)
      this.tick()
    }
    this.frameId = this.scheduler.request(frame)
  }

  dispose(): void {
    if (this.frameId !== null) this.scheduler.cancel(this.frameId)
    this.frameId = null
    this.cancelScheduled()
  }

  /** Golpes agendados todavía pendientes de sonar (tests y depuración). */
  get pendingHits(): number {
    return this.scheduled.length
  }

  /** Un paso del scheduler. Público para tests. */
  tick(): void {
    const now = this.ctx.currentTime
    this.scheduled = this.scheduled.filter(h => h.endCtx > now)

    if (this.clock.epoch !== this.epoch) {
      this.epoch = this.clock.epoch
      this.cancelScheduled()
      this.cursor = this.clock.songAtCtx(now)
    }
    if (!this.clock.isPlaying) return

    const until = this.clock.songAtCtx(now + LOOKAHEAD_S)
    if (until <= this.cursor) return
    for (const i of notesInWindow(this.notes, this.cursor, until)) {
      const note = this.notes[i]
      const when = this.clock.songToCtx(note.t)
      // Una nota que ya pasó (frame tardío) se salta, como en el metrónomo
      if (when !== null && when >= now) this.hit(when, note)
    }
    this.cursor = until
  }

  private hit(when: number, note: ChartNote): void {
    const buffer = this.buffers[note.piece]
    const source = this.ctx.createBufferSource()
    const gain = this.ctx.createGain()
    source.buffer = buffer
    gain.gain.value = velocityGain(note.velocity)
    source.connect(gain)
    gain.connect(this.output)
    source.start(when)
    source.onended = () => {
      source.disconnect()
      gain.disconnect()
    }
    this.scheduled.push({ source, gain, endCtx: when + buffer.duration })
  }

  private cancelScheduled(): void {
    for (const { source, gain } of this.scheduled) {
      source.onended = null
      source.stop()
      source.disconnect()
      gain.disconnect()
    }
    this.scheduled = []
  }
}

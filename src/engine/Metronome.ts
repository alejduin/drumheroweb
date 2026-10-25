import type { ChartGrid } from '@/types'
import type { AudioClock } from '@/audio/AudioClock'
import { rafScheduler } from './GameEngine'
import type { FrameScheduler } from './GameEngine'

// ─── Metrónomo v2 ─────────────────────────────────────────────────────────────
// Clicks agendados en el AudioContext a partir de grid.beats (PLAN_V2 B9). El
// scheduler corre por requestAnimationFrame y agenda con LOOKAHEAD_S de margen;
// el instante exacto de cada click lo fija el reloj de audio, no el frame.

/** Margen de agendado: cubre frames de hasta ~150 ms sin perder clicks. */
export const LOOKAHEAD_S = 0.15

/** Duración del click (envolvente exponencial). */
export const CLICK_DURATION_S = 0.04

// Tono más agudo en el primer tiempo del compás
export const ACCENT_FREQUENCY_HZ = 1500
export const BEAT_FREQUENCY_HZ = 1000
const ACCENT_GAIN = 1
const BEAT_GAIN = 0.6

export interface MetronomeBeat {
  index: number // índice en grid.beats
  t: number // segundos de canción
  downbeat: boolean
}

// Un downbeat es un beat de la rejilla; se comparan con tolerancia por los decimales del JSON
const SAME_TIME_S = 1e-6

/** Primer índice con sorted[i] >= x. */
function lowerBound(sorted: readonly number[], x: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Beats con from <= t < to, en orden, marcando los primeros tiempos de compás (acento). */
export function beatsInWindow(grid: ChartGrid, from: number, to: number): MetronomeBeat[] {
  const { beats, downbeats } = grid
  const result: MetronomeBeat[] = []
  let d = lowerBound(downbeats, from - SAME_TIME_S)
  for (let i = lowerBound(beats, from); i < beats.length && beats[i] < to; i++) {
    const t = beats[i]
    while (d < downbeats.length && downbeats[d] < t - SAME_TIME_S) d++
    const downbeat = d < downbeats.length && Math.abs(downbeats[d] - t) <= SAME_TIME_S
    result.push({ index: i, t, downbeat })
  }
  return result
}

/** Subconjunto de AudioContext que usa el metrónomo (fake en tests). */
export interface MetronomeContext {
  readonly currentTime: number
  createOscillator(): OscillatorNode
  createGain(): GainNode
}

/** Lo que el metrónomo necesita del reloj maestro. */
export type MetronomeClock = Pick<AudioClock, 'isPlaying' | 'epoch' | 'songAtCtx' | 'songToCtx'>

export interface MetronomeDeps {
  ctx: MetronomeContext
  clock: MetronomeClock
  grid: ChartGrid
  /** Canal "metronome" del Mixer: el volumen se controla ahí. */
  output: AudioNode
  scheduler?: FrameScheduler
}

interface ScheduledClick {
  osc: OscillatorNode
  gain: GainNode
  endCtx: number
}

/**
 * Metrónomo agendado sobre el reloj maestro. Cada frame agenda los beats que
 * empiezan antes de currentTime + LOOKAHEAD_S. Si el reloj se reancla (play,
 * pausa, seek, cambio de velocidad), cancela lo agendado y sigue desde la nueva
 * posición: los clicks quedan alineados al beat sin que nadie le avise.
 */
export class Metronome {
  private readonly ctx: MetronomeContext
  private readonly clock: MetronomeClock
  private readonly grid: ChartGrid
  private readonly output: AudioNode
  private readonly scheduler: FrameScheduler

  private epoch = -1
  /** Siguiente instante de canción por agendar. */
  private cursor = 0
  private scheduled: ScheduledClick[] = []
  private frameId: number | null = null

  constructor({ ctx, clock, grid, output, scheduler = rafScheduler }: MetronomeDeps) {
    this.ctx = ctx
    this.clock = clock
    this.grid = grid
    this.output = output
    this.scheduler = scheduler
  }

  /** Arranca el bucle de agendado (sigue vivo en pausa; solo agenda si suena el audio). */
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

  /** Clicks agendados todavía pendientes de sonar (tests y depuración). */
  get pendingClicks(): number {
    return this.scheduled.length
  }

  /** Un paso del scheduler. Público para tests. */
  tick(): void {
    const now = this.ctx.currentTime
    this.scheduled = this.scheduled.filter(c => c.endCtx > now)

    if (this.clock.epoch !== this.epoch) {
      // Reanclado: lo agendado corresponde a otra posición o velocidad
      this.epoch = this.clock.epoch
      this.cancelScheduled()
      this.cursor = this.clock.songAtCtx(now)
    }
    if (!this.clock.isPlaying) return

    const until = this.clock.songAtCtx(now + LOOKAHEAD_S)
    if (until <= this.cursor) return
    for (const beat of beatsInWindow(this.grid, this.cursor, until)) {
      const when = this.clock.songToCtx(beat.t)
      // Un beat que ya pasó (frame tardío) se salta: un click tarde despista más que uno de menos
      if (when !== null && when >= now) this.click(when, beat.downbeat)
    }
    this.cursor = until
  }

  private click(when: number, accent: boolean): void {
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.frequency.value = accent ? ACCENT_FREQUENCY_HZ : BEAT_FREQUENCY_HZ
    const end = when + CLICK_DURATION_S
    gain.gain.setValueAtTime(accent ? ACCENT_GAIN : BEAT_GAIN, when)
    gain.gain.exponentialRampToValueAtTime(0.001, end)
    osc.connect(gain)
    gain.connect(this.output)
    osc.start(when)
    osc.stop(end)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
    this.scheduled.push({ osc, gain, endCtx: end })
  }

  private cancelScheduled(): void {
    for (const { osc, gain } of this.scheduled) {
      osc.onended = null
      osc.stop()
      osc.disconnect()
      gain.disconnect()
    }
    this.scheduled = []
  }
}

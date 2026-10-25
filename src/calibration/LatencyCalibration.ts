import type { ChartGrid } from '@/types'
import { AudioClock } from '@/audio/AudioClock'
import type { ClockContext } from '@/audio/AudioClock'
import { START_LEAD_S } from '@/audio/StemPlayer'
import { rafScheduler } from '@/engine/GameEngine'
import type { FrameScheduler } from '@/engine/GameEngine'
import { Metronome } from '@/engine/Metronome'
import type { MetronomeContext } from '@/engine/Metronome'
import {
  CALIBRATION_HITS,
  CALIBRATION_INTERVAL_S,
  COUNT_IN_BEATS,
  MAX_HIT_DISTANCE_MS,
  calibrationGrid,
  computeLatency,
  nearestClick,
} from './latency'
import type { LatencyResult } from './latency'

/** Subconjunto de AudioContext que usa la calibración (fake en tests). */
export interface CalibrationContext extends ClockContext, MetronomeContext {
  readonly destination: AudioNode
  readonly state: AudioContextState
  resume(): Promise<void>
  close(): Promise<void>
}

export interface CalibrationDeps {
  createContext?: () => CalibrationContext
  /** noteOn crudos (midiManager.onNoteOn): cualquier pad sirve, no depende del mapa. */
  subscribeNoteOn: (callback: (noteOn: { timestamp: number }) => void) => () => void
  scheduler?: FrameScheduler
  perfNow?: () => number
}

export type CalibrationPhase = 'count-in' | 'measuring' | 'done'

export interface CalibrationProgress {
  phase: CalibrationPhase
  /** Último click que ya sonó (índice en la rejilla; -1 antes del primero). */
  beat: number
  /** Golpe − click en ms por click medido; null = sin golpe (todavía o perdido). */
  samples: Array<number | null>
  /** Al terminar: null si hubo menos de MIN_LATENCY_SAMPLES golpes. */
  result: LatencyResult | null
}

/**
 * Una corrida de calibración: pista de clicks (Metronome sobre un AudioClock) y
 * golpes convertidos con clock.perfToSong(timeStamp), igual que en la partida.
 * Termina al juntar CALIBRATION_HITS golpes o cuando pasa el último click.
 */
export class LatencyCalibration {
  readonly grid: ChartGrid = calibrationGrid()
  readonly clock: AudioClock

  private readonly ctx: CalibrationContext
  private readonly output: GainNode
  private readonly metronome: Metronome
  private readonly scheduler: FrameScheduler
  private readonly subscribeNoteOn: CalibrationDeps['subscribeNoteOn']
  private readonly listeners = new Set<(progress: CalibrationProgress) => void>()

  private progress: CalibrationProgress = {
    phase: 'count-in',
    beat: -1,
    samples: Array<number | null>(CALIBRATION_HITS).fill(null),
    result: null,
  }
  private unsubscribe: (() => void) | null = null
  private frameId: number | null = null
  private disposed = false

  constructor(deps: CalibrationDeps) {
    this.ctx = (deps.createContext ?? defaultContext)()
    this.clock = new AudioClock(this.ctx, deps.perfNow)
    this.scheduler = deps.scheduler ?? rafScheduler
    this.subscribeNoteOn = deps.subscribeNoteOn
    this.output = this.ctx.createGain()
    this.output.connect(this.ctx.destination)
    this.metronome = new Metronome({
      ctx: this.ctx,
      clock: this.clock,
      grid: this.grid,
      output: this.output,
    })
  }

  get state(): CalibrationProgress {
    return this.progress
  }

  /** Avisa en cada click y en cada golpe (no por frame). Retorna la baja. */
  subscribe(listener: (progress: CalibrationProgress) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Arranca la pista de clicks; llamar desde un gesto del usuario (AudioContext). */
  async start(): Promise<void> {
    if (this.disposed || this.unsubscribe) return
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.clock.start(this.ctx.currentTime + START_LEAD_S, 0)
    this.unsubscribe = this.subscribeNoteOn(n => this.handleHit(n.timestamp))
    const frame = () => {
      this.frameId = this.scheduler.request(frame)
      this.tick()
    }
    this.frameId = this.scheduler.request(frame)
  }

  /** Un golpe con su MIDIMessageEvent.timeStamp. Público para tests. */
  handleHit(perfMs: number): void {
    if (this.progress.phase === 'done' || !this.clock.isPlaying) return
    const t = this.clock.perfToSong(perfMs)
    const index = nearestClick(this.grid, t)
    // Un solo golpe por click: el primero (los rebotes del pad no cuentan)
    if (index === null || this.progress.samples[index] !== null) return
    const samples = [...this.progress.samples]
    samples[index] = (t - this.grid.beats[COUNT_IN_BEATS + index]) * 1000
    this.update({ samples })
    if (samples.every(s => s !== null)) this.finish()
  }

  /** Un frame: agenda clicks, avanza el click actual y termina tras el último. Público para tests. */
  tick(): void {
    if (this.progress.phase === 'done' || !this.clock.isPlaying) return
    this.metronome.tick()
    const t = this.clock.now()
    const { beats } = this.grid
    const lastBeat = beats[beats.length - 1]
    if (t > lastBeat + MAX_HIT_DISTANCE_MS / 1000) {
      this.finish()
      return
    }
    const beat = Math.floor((t - beats[0]) / CALIBRATION_INTERVAL_S + 1e-9)
    const clamped = Math.min(beat, beats.length - 1)
    if (clamped !== this.progress.beat) {
      this.update({ beat: clamped, phase: clamped >= COUNT_IN_BEATS ? 'measuring' : 'count-in' })
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    this.listeners.clear()
    this.output.disconnect()
    void this.ctx.close()
  }

  private finish(): void {
    this.stop()
    const samples = this.progress.samples.filter((s): s is number => s !== null)
    this.update({ phase: 'done', result: computeLatency(samples) })
  }

  private stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.frameId !== null) this.scheduler.cancel(this.frameId)
    this.frameId = null
    this.metronome.dispose()
    this.clock.pause()
  }

  private update(patch: Partial<CalibrationProgress>): void {
    this.progress = { ...this.progress, ...patch }
    this.listeners.forEach(listener => listener(this.progress))
  }
}

function defaultContext(): CalibrationContext {
  return new AudioContext({ latencyHint: 'interactive' })
}

import type { SongClock } from '@/audio/AudioClock'
import type { ChartNote, ChartV2, Difficulty, JudgementEvent, MidiHit } from '@/types'
import { HitEvaluator } from './HitEvaluator'
import type { HitEvaluatorOptions } from './HitEvaluator'

// Margen antes de dar una nota por Fallo: un MIDIMessageEvent con timestamp anterior
// puede llegar después del frame (cola de eventos del hilo principal). Tiempo real.
export const MISS_GRACE_S = 0.03

/** Juicio con su instante en segundos de canción (nota para aciertos y Fallos, golpe para pad incorrecto). */
export type TimedJudgement = JudgementEvent & { t: number }

export interface LoopRange {
  startS: number
  endS: number
}

/** Resultado de una vuelta del loop A–B (para la rampa de tempo de D3). */
export interface LoopLap {
  lap: number // 1, 2, …
  judgements: readonly TimedJudgement[] // los de esta vuelta, dentro del rango
}

/** Quien mueve el audio (StemPlayer). El engine lo usa para el loop A–B. */
export interface Transport {
  seek(songTime: number): void
}

/** Agenda de frames (requestAnimationFrame en la app; manual en tests). */
export interface FrameScheduler {
  request(callback: () => void): number
  cancel(id: number): void
}

export const rafScheduler: FrameScheduler = {
  request: callback => requestAnimationFrame(callback),
  cancel: id => cancelAnimationFrame(id),
}

export type EnginePhase = 'idle' | 'running' | 'ended'

export interface GameEngineDeps {
  clock: SongClock
  transport?: Transport
  scheduler?: FrameScheduler
}

type Listener<T> = (value: T) => void

/**
 * GameEngine v2 — juega un chart sobre el reloj maestro (SongClock).
 *
 * No reproduce audio ni lleva tiempo propio: en cada frame lee clock.now(), expira
 * las notas cuya ventana cerró (Fallos), detecta el fin por durationS y el loop A–B.
 * Los golpes MIDI se evalúan con su propio timestamp vía clock.perfToSong().
 *
 * Mantiene el registro de juicios de la partida; un seek lo recorta y avisa con
 * onReset para que el scoring se reconstruya (B6).
 */
export class GameEngine {
  private readonly clock: SongClock
  private readonly transport: Transport | null
  private readonly scheduler: FrameScheduler

  private chart: ChartV2 | null = null
  private notes: readonly ChartNote[] = []
  private evaluator: HitEvaluator | null = null
  private log: TimedJudgement[] = []
  private loop: LoopRange | null = null
  private loopLap = 0
  private frameId: number | null = null
  private currentPhase: EnginePhase = 'idle'

  private readonly judgementListeners = new Set<Listener<TimedJudgement>>()
  private readonly resetListeners = new Set<Listener<readonly TimedJudgement[]>>()
  private readonly loopListeners = new Set<Listener<LoopLap>>()
  private readonly endListeners = new Set<Listener<readonly TimedJudgement[]>>()

  constructor({ clock, transport, scheduler = rafScheduler }: GameEngineDeps) {
    this.clock = clock
    this.transport = transport ?? null
    this.scheduler = scheduler
  }

  get phase(): EnginePhase {
    return this.currentPhase
  }

  /** Notas de la dificultad cargada (índices = noteIndex de los juicios). */
  get chartNotes(): readonly ChartNote[] {
    return this.notes
  }

  /** Juicios de la partida en orden de llegada. */
  get judgements(): readonly TimedJudgement[] {
    return this.log
  }

  load(chart: ChartV2, difficulty: Difficulty, options: HitEvaluatorOptions): void {
    this.stop()
    this.chart = chart
    this.notes = chart.difficulties[difficulty].notes
    this.evaluator = new HitEvaluator(this.notes, options)
    this.log = []
    this.loop = null
    this.loopLap = 0
    this.currentPhase = 'idle'
    this.evaluator.seek(this.clock.now())
  }

  /** Arranca el bucle de frames. El audio lo arranca quien controla el StemPlayer. */
  start(): void {
    if (!this.chart || this.currentPhase === 'running') return
    if (this.currentPhase === 'ended') this.seek(0)
    this.currentPhase = 'running'
    this.scheduleFrame()
  }

  /** Detiene el bucle (pausa o salida). El estado de la partida se conserva. */
  stop(): void {
    if (this.frameId !== null) this.scheduler.cancel(this.frameId)
    this.frameId = null
    if (this.currentPhase === 'running') this.currentPhase = 'idle'
  }

  /**
   * Reconstruye el estado para jugar desde `songTime`: se descartan los juicios
   * desde ese punto y esas notas vuelven a estar pendientes. Llamar después de
   * mover el audio (player.seek).
   */
  seek(songTime: number): void {
    if (!this.evaluator) return
    this.evaluator.seek(songTime)
    this.log = this.log.filter(j => j.t < songTime)
    if (this.currentPhase === 'ended') this.currentPhase = 'idle'
    this.emit(this.resetListeners, this.log)
  }

  /** Loop A–B: al llegar a endS vuelve a startS (Fase D). null lo desactiva. */
  setLoop(range: LoopRange | null): void {
    if (range && !(range.endS > range.startS)) {
      throw new RangeError(`loop inválido: ${range.startS}–${range.endS}`)
    }
    this.loop = range
    this.loopLap = 0
  }

  /** Golpe MIDI: se evalúa con su timestamp convertido al tiempo de la canción. */
  handleHit(hit: MidiHit): TimedJudgement | null {
    if (!this.evaluator || !this.chart || this.currentPhase !== 'running') return null
    if (!this.clock.isPlaying) return null
    const t = this.clock.perfToSong(hit.timestamp)
    if (t < 0 || t > this.chart.durationS) return null
    this.evaluator.setRate(this.clock.playbackRate)
    const result = this.evaluator.judge({ t, piece: hit.instrument, velocity: hit.velocity })
    const timed: TimedJudgement =
      result.judgement === 'wrong_pad'
        ? { ...result, t }
        : { ...result, t: this.notes[result.noteIndex].t }
    this.record(timed)
    return timed
  }

  /** Un paso del bucle. Público para tests y para forzar una actualización tras un seek. */
  tick(): void {
    if (!this.evaluator || !this.chart || this.currentPhase !== 'running') return
    const now = this.clock.now()
    // Las ventanas se miden en tiempo real: siguen al tempo del reloj (D2)
    const rate = this.clock.playbackRate
    this.evaluator.setRate(rate)

    if (this.loop && now >= this.loop.endS) {
      const { startS, endS } = this.loop
      // Las notas antes de endS ya no se pueden tocar en esta vuelta: Fallo
      this.expireUntil(endS + this.evaluator.closeWindowS)
      this.loopLap++
      this.emit(this.loopListeners, {
        lap: this.loopLap,
        judgements: this.log.filter(j => j.t >= startS && j.t < endS),
      })
      this.transport?.seek(startS)
      this.seek(startS)
      return
    }

    if (now >= this.chart.durationS) {
      this.finish()
      return
    }

    this.expireUntil(now - MISS_GRACE_S * rate)
  }

  /**
   * Termina la partida: las notas pendientes son Fallo. Lo llama tick() al llegar a
   * durationS, o quien reproduce el audio si este acaba antes que el chart.
   */
  finish(): void {
    if (!this.evaluator || this.currentPhase === 'ended') return
    this.expireUntil(Infinity)
    this.stop()
    this.currentPhase = 'ended'
    this.emit(this.endListeners, this.log)
  }

  /** Puntos por dinámica para los golpes siguientes (Configuración, en plena partida). */
  setDynamicsBonus(on: boolean): void {
    this.evaluator?.setDynamicsBonus(on)
  }

  // ─── Suscripciones ───────────────────────────────────────────────────────────

  onJudgement(listener: Listener<TimedJudgement>): () => void {
    return this.subscribe(this.judgementListeners, listener)
  }

  /** Tras un seek o una vuelta del loop, con los juicios que siguen vigentes. */
  onReset(listener: Listener<readonly TimedJudgement[]>): () => void {
    return this.subscribe(this.resetListeners, listener)
  }

  /** Vuelta completa del loop A–B, con sus juicios (antes de volver a startS). */
  onLoop(listener: Listener<LoopLap>): () => void {
    return this.subscribe(this.loopListeners, listener)
  }

  onEnd(listener: Listener<readonly TimedJudgement[]>): () => void {
    return this.subscribe(this.endListeners, listener)
  }

  // ─── Internos ─────────────────────────────────────────────────────────────────

  private scheduleFrame(): void {
    this.frameId = this.scheduler.request(() => {
      this.frameId = null
      this.tick()
      if (this.currentPhase === 'running') this.scheduleFrame()
    })
  }

  private expireUntil(songT: number): void {
    for (const miss of this.evaluator!.expire(songT)) {
      this.record({ ...miss, t: this.notes[miss.noteIndex].t })
    }
  }

  private record(judgement: TimedJudgement): void {
    this.log.push(judgement)
    this.emit(this.judgementListeners, judgement)
  }

  private subscribe<T>(set: Set<Listener<T>>, listener: Listener<T>): () => void {
    set.add(listener)
    return () => set.delete(listener)
  }

  private emit<T>(set: Set<Listener<T>>, value: T): void {
    set.forEach(listener => listener(value))
  }
}

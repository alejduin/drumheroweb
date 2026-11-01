import type {
  ChartSection,
  ChartV2,
  Difficulty,
  Level,
  MidiHit,
  Piece,
  WaveformPeaks,
} from '@/types'
import { Mixer } from '@/audio/Mixer'
import type { MixChannel, MixLevels, MixPreset, MixerContext } from '@/audio/Mixer'
import { createSongPlayer } from '@/audio/StemPlayer'
import type { PlayerContext, StemPlayer } from '@/audio/StemPlayer'
import { loadSongAudio } from '@/audio/loadSongAudio'
import { createKitBuffers } from '@/audio/drumSynth'
import { stretchBuffers, stretchInWorker } from '@/audio/tempo'
import type { StretchBufferContext, StretchFn, StretchRegion } from '@/audio/tempo'
import { normalizeTempo } from '@/audio/timeStretch'
import type { KitBufferContext } from '@/audio/drumSynth'
import type { DecodeContext, SongAudio, SongAudioSources } from '@/audio/loadSongAudio'
import { GameEngine } from '@/engine/GameEngine'
import type { FrameScheduler } from '@/engine/GameEngine'
import { KitPlayer } from '@/engine/KitPlayer'
import { Metronome } from '@/engine/Metronome'
import type { MetronomeContext } from '@/engine/Metronome'
import { ScoreManager } from '@/scoring/ScoreManager'
import { bindScoring, useGameStore } from '@/store/gameStore'
import { ensureDifficulties } from '@/chart/difficulties'
import {
  clampLoop,
  countInClicks,
  countInLengthS,
  lapPrecision,
  loopRange,
  nextRampTempo,
} from './practice'
import type { LapResult, PracticeLoop } from './practice'
import type { LoopLap, LoopRange, WaitState } from '@/engine/GameEngine'
import type { PracticeLayer } from '@/chart/layers'
import { effectiveSections } from './sections'

export type { LapResult } from './practice'
import { computePeaks } from './waveform'

/** Frecuencia de la pista silenciosa de los charts sin audio (mínimo que acepta createBuffer). */
export const SILENT_SAMPLE_RATE = 8000

/** Lo que hace falta para jugar una canción. */
export interface SongBundle {
  chart: ChartV2
  /** null = chart sin audio (los incluidos): suena una pista silenciosa que hace de reloj. */
  audio: SongAudioSources | null
  /** peaks.json del worker; si falta se calcula del audio decodificado. */
  peaks: WaveformPeaks | null
  /** Nombre del archivo que hace de reloj maestro ("mi-cancion.mp3"). */
  fileName: string | null
}

export interface SessionOptions {
  difficulty: Difficulty
  level: Level
  latencyMs: number
  dynamicsBonus: boolean
  mix: Readonly<MixLevels>
  /** Cuenta de un compás al empezar o reanudar (D3). */
  countIn?: boolean
  /** Rampa de tempo: +5 % al lograr ≥ 90 % en una vuelta del loop (D3). */
  tempoRamp?: boolean
  /** Modo espera: la partida se detiene en cada nota hasta tocarla (D4). */
  waitMode?: boolean
  /** Capa de práctica: qué piezas se tocan (D5); por defecto el kit completo. */
  layer?: PracticeLayer
}

/** Estado de práctica para la UI: cambia por acción del usuario o por la rampa. */
export interface PracticeState {
  /** Tempo pedido (0,5–1). */
  tempo: number
  /** Las pistas se están estirando al tempo pedido (mientras, suena el anterior). */
  tempoPending: boolean
  tempoError: string | null
  loop: PracticeLoop | null
  countIn: boolean
  tempoRamp: boolean
  lastLap: LapResult | null
  waitMode: boolean
  /** Piezas que faltan para seguir (modo espera); null = no está detenida. */
  waitingFor: readonly Piece[] | null
}

// Margen alrededor del loop al estirar solo ese tramo
const REGION_MARGIN_BEFORE_S = 0.5
const REGION_MARGIN_AFTER_S = 1

/** Subconjunto de AudioContext que usa la sesión (fake en tests). */
export interface SessionContext
  extends
    PlayerContext,
    MixerContext,
    DecodeContext,
    MetronomeContext,
    KitBufferContext,
    StretchBufferContext {
  readonly state: AudioContextState
  resume(): Promise<void>
  close(): Promise<void>
}

export interface SessionDeps {
  createContext?: () => SessionContext
  /** Golpes del kit (midiManager.onHit en la app). */
  subscribeHits: (callback: (hit: MidiHit) => void) => () => void
  scheduler?: FrameScheduler
  perfNow?: () => number
  /** Time-stretch de las pistas (Web Worker en la app). */
  stretch?: StretchFn
}

/** Audio de la sesión: los stems, el MP3 original (fallback) o la pista silenciosa. */
export type AudioMode = SongAudio['mode'] | 'silent'

/**
 * GameSession — una partida: AudioContext + mezclador + StemPlayer (reloj maestro) +
 * GameEngine + ScoreManager conectado al gameStore + golpes MIDI.
 *
 * Es la única que mueve el audio y el engine juntos (play/pausa/seek), así el reloj
 * y la evaluación nunca se separan. Se crea con `GameSession.open()`.
 */
export class GameSession {
  readonly chart: ChartV2
  readonly sections: readonly ChartSection[]
  readonly engine: GameEngine
  readonly player: StemPlayer
  readonly mixer: Mixer
  readonly metronome: Metronome
  /** Toca la partitura con los sonidos del kit (canal "samples"). */
  readonly kit: KitPlayer
  readonly peaks: WaveformPeaks
  readonly audioMode: AudioMode
  readonly fallbackReason: string | null
  readonly fileName: string | null

  private readonly ctx: SessionContext
  private readonly unsubs: Array<() => void>
  private options: SessionOptions
  private unbindScoring: () => void
  private disposed = false
  /** Pistas originales (en el orden del StemPlayer), fuente del time-stretch. */
  private readonly trackBuffers: readonly AudioBuffer[]
  private readonly stretch: StretchFn
  private targetTempo = 1
  private tempoJob: AbortController | null = null
  private tempoError: string | null = null
  /** Tramo estirado que tiene el reproductor; null = la canción entera (o nada). */
  private stretchedRegion: StretchRegion | null = null
  private loop: PracticeLoop | null = null
  private loopSeconds: LoopRange | null = null
  private countIn: boolean
  private tempoRamp: boolean
  private lastLap: LapResult | null = null
  private practiceSnapshot: PracticeState
  private readonly practiceListeners = new Set<() => void>()
  // Tiempo real tocando, para el historial (D7); no es el reloj del juego
  private readonly perfNow: () => number
  private playedMs = 0
  private playingSince: number | null = null

  private constructor(
    ctx: SessionContext,
    bundle: SongBundle,
    audio: SongAudio | null,
    options: SessionOptions,
    deps: SessionDeps,
  ) {
    this.ctx = ctx
    this.perfNow = deps.perfNow ?? (() => performance.now())
    this.countIn = options.countIn ?? false
    this.tempoRamp = options.tempoRamp ?? false
    // El worker solo emite `full`: Básico e Intermedio se generan aquí si faltan
    this.chart = ensureDifficulties(bundle.chart)
    this.options = options
    this.fileName = bundle.fileName
    this.sections = effectiveSections(bundle.chart)
    this.mixer = new Mixer(ctx, options.mix)

    const song: SongAudio = audio ?? {
      mode: 'original',
      tracks: [{ channel: 'backing', buffer: silentBuffer(ctx, bundle.chart.durationS) }],
      fallbackReason: null,
    }
    this.audioMode = audio ? audio.mode : 'silent'
    this.fallbackReason = song.fallbackReason
    this.peaks = bundle.peaks ?? computePeaks(song.tracks[song.tracks.length - 1].buffer)

    this.trackBuffers = song.tracks.map(t => t.buffer)
    this.stretch = deps.stretch ?? stretchInWorker
    this.player = createSongPlayer(ctx, song, this.mixer, deps.perfNow)
    this.engine = new GameEngine({
      clock: this.player.clock,
      transport: this.player,
      scheduler: deps.scheduler,
    })
    this.unbindScoring = this.loadNotes(options.difficulty)
    this.unsubs = [deps.subscribeHits(hit => this.engine.handleHit(hit))]
    // Si el audio acaba antes que el chart, el engine no llegaría a durationS
    this.player.onEnded(() => this.engine.finish())
    // Cada vuelta del loop: precisión y rampa de tempo
    this.engine.onLoop(lap => this.handleLap(lap))
    this.engine.onEnd(() => this.stopPlayTimer())
    // Modo espera: el audio se detiene en la nota y sigue al tocarla
    this.engine.setWaitMode(options.waitMode ?? false)
    this.engine.onWait(wait => this.handleWait(wait))

    // Clicks en el canal "metronome" del mezclador; se realinea solo al pausar o hacer seek
    this.metronome = new Metronome({
      ctx,
      clock: this.player.clock,
      grid: this.chart.grid,
      output: this.mixer.input('metronome'),
      // La cuenta se oye aunque el metrónomo esté en 0
      countInOutput: ctx.destination,
      scheduler: deps.scheduler,
    })
    this.metronome.start()

    // Escuchar la transcripción: las notas de la dificultad cargada en el canal "samples"
    this.kit = new KitPlayer({
      ctx,
      clock: this.player.clock,
      buffers: createKitBuffers(ctx),
      notes: this.engine.chartNotes,
      output: this.mixer.input('samples'),
      scheduler: deps.scheduler,
    })
    this.kit.start()
    this.practiceSnapshot = this.buildPractice()
  }

  /** Decodifica el audio y prepara la partida (en pausa, en 0). */
  static async open(
    bundle: SongBundle,
    options: SessionOptions,
    deps: SessionDeps,
  ): Promise<GameSession> {
    const ctx = (deps.createContext ?? defaultContext)()
    try {
      const audio = bundle.audio ? await loadSongAudio(ctx, bundle.audio) : null
      return new GameSession(ctx, bundle, audio, options, deps)
    } catch (error) {
      void ctx.close()
      throw error
    }
  }

  /** Carga las notas de esa dificultad en el engine y les conecta un marcador nuevo. */
  private loadNotes(difficulty: Difficulty): () => void {
    const { level, latencyMs, dynamicsBonus, layer = 'full' } = this.options
    this.engine.load(this.chart, difficulty, { level, latencyMs, dynamicsBonus }, layer)
    const scoring = new ScoreManager({
      notes: this.engine.chartNotes,
      grid: this.chart.grid,
      sections: this.sections,
    })
    return bindScoring(this.engine, scoring)
  }

  get difficulty(): Difficulty {
    return this.options.difficulty
  }

  /**
   * Cambia la dificultad sin recargar el audio: la partida se pausa y vuelve a
   * empezar desde la misma posición con las notas nuevas (el marcador se reinicia).
   */
  setDifficulty(difficulty: Difficulty): void {
    if (this.disposed || difficulty === this.options.difficulty) return
    this.reloadNotes({ ...this.options, difficulty })
  }

  get layer(): PracticeLayer {
    return this.options.layer ?? 'full'
  }

  /** Práctica por capas (D5): como la dificultad, reinicia el marcador en la misma posición. */
  setLayer(layer: PracticeLayer): void {
    if (this.disposed || layer === this.layer) return
    this.reloadNotes({ ...this.options, layer })
  }

  /** Recarga las notas con otras opciones: pausa y sigue desde la misma posición. */
  private reloadNotes(options: SessionOptions): void {
    const position = this.clock.now()
    this.pause()
    this.options = options
    this.unbindScoring()
    this.unbindScoring = this.loadNotes(options.difficulty)
    this.kit.setNotes(this.engine.chartNotes)
    // engine.load quita el loop: se vuelve a poner
    this.engine.setLoop(this.loopSeconds)
    this.seek(position)
  }

  /** Tempo pedido (0,5–1). Mientras se prepara, la canción sigue al tempo anterior. */
  get tempo(): number {
    return this.targetTempo
  }

  /**
   * Cambia el tempo sin cambiar el tono (PLAN_V2 D2). Las pistas se estiran en un
   * worker y, al terminar, la canción sigue desde la misma posición al nuevo tempo;
   * mientras tanto suena como antes. Con un loop activo solo se estira su tramo
   * (rápido, para la rampa). Un cambio nuevo cancela el que estaba en curso.
   * Resuelve true si se aplicó, false si otro cambio lo reemplazó.
   */
  async setTempo(tempo: number): Promise<boolean> {
    if (this.disposed) return false
    this.targetTempo = normalizeTempo(tempo)
    return this.applyTempo()
  }

  // ─── Práctica (D3) ────────────────────────────────────────────────────────────

  /** Estado de práctica (instantánea inmutable, para useSyncExternalStore). */
  get practice(): PracticeState {
    return this.practiceSnapshot
  }

  /** Avisa cada vez que cambia `practice`. */
  subscribePractice = (listener: () => void): (() => void) => {
    this.practiceListeners.add(listener)
    return () => this.practiceListeners.delete(listener)
  }

  /**
   * Loop A–B por compases; null lo quita. Si la posición queda fuera, salta al
   * inicio del loop. Al volver a A no hay cuenta: el loop sigue sin cortes.
   */
  setLoop(loop: PracticeLoop | null): void {
    if (this.disposed) return
    const clamped = loop ? clampLoop(this.chart.grid, loop) : null
    this.loop = clamped
    this.loopSeconds = clamped ? loopRange(this.chart.grid, this.durationS, clamped) : null
    this.lastLap = null
    this.engine.setLoop(this.loopSeconds)
    const range = this.loopSeconds
    if (range) {
      const now = this.clock.now()
      if (now < range.startS || now >= range.endS) this.seek(range.startS)
    }
    this.emitPractice()
    // El tramo estirado depende del loop
    if (this.targetTempo !== 1) this.applyTempoQuietly()
  }

  setCountIn(on: boolean): void {
    this.countIn = on
    this.emitPractice()
  }

  setTempoRamp(on: boolean): void {
    this.tempoRamp = on
    this.emitPractice()
  }

  private handleLap(lap: LoopLap): void {
    const precision = lapPrecision(lap.judgements)
    const tempo = this.targetTempo
    const nextTempo = this.tempoRamp ? nextRampTempo(tempo, precision) : tempo
    this.lastLap = { lap: lap.lap, precision, tempo, nextTempo }
    if (nextTempo !== tempo) {
      this.targetTempo = nextTempo
      this.applyTempoQuietly()
    }
    this.emitPractice()
  }

  /** Tramo a estirar: el loop con un margen, o null (la canción entera). */
  private stretchRegionFor(): StretchRegion | null {
    const range = this.loopSeconds
    if (!range) return null
    return {
      startS: Math.max(range.startS - REGION_MARGIN_BEFORE_S, 0),
      endS: Math.min(range.endS + REGION_MARGIN_AFTER_S, this.durationS),
    }
  }

  /** Si lo que tiene el reproductor ya cubre `region` (null = la canción entera). */
  private coversRegion(region: StretchRegion | null): boolean {
    const current = this.stretchedRegion
    if (!current) return true // la canción entera
    if (!region) return false
    return current.startS <= region.startS && current.endS >= region.endS
  }

  /** applyTempo desde la rampa o el loop: el error queda en `practice.tempoError`. */
  private applyTempoQuietly(): void {
    this.applyTempo().catch(() => {})
  }

  /** Lleva el audio al tempo pedido. */
  private async applyTempo(): Promise<boolean> {
    this.tempoJob?.abort()
    this.tempoJob = null
    this.tempoError = null
    const rate = this.targetTempo
    const region = this.stretchRegionFor()
    if (rate === this.player.playbackRate && (rate === 1 || this.coversRegion(region))) {
      this.emitPractice()
      return true
    }
    // Sin música (pista silenciosa) no hay tono que conservar
    if (rate === 1 || this.audioMode === 'silent') {
      this.player.setTempo(rate, null)
      this.stretchedRegion = null
      this.emitPractice()
      return true
    }
    const job = new AbortController()
    this.tempoJob = job
    this.emitPractice()
    try {
      const audio = await stretchBuffers(
        this.ctx,
        this.trackBuffers,
        rate,
        this.stretch,
        job.signal,
        region,
      )
      if (job.signal.aborted || this.disposed) return false
      this.player.setTempo(rate, audio)
      this.stretchedRegion = region
      return true
    } catch (error) {
      if (job.signal.aborted || this.disposed) return false
      // Si falla, se queda en el tempo que estaba sonando
      this.targetTempo = this.player.playbackRate
      this.tempoError = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      if (this.tempoJob === job) {
        this.tempoJob = null
        this.emitPractice()
      }
    }
  }

  private buildPractice(): PracticeState {
    return {
      tempo: this.targetTempo,
      tempoPending: this.tempoJob !== null,
      tempoError: this.tempoError,
      loop: this.loop,
      countIn: this.countIn,
      tempoRamp: this.tempoRamp,
      lastLap: this.lastLap,
      waitMode: this.engine.isWaitMode,
      waitingFor: this.engine.waitState?.pending ?? null,
    }
  }

  /** Activa o quita el modo espera; quitarlo mientras espera reanuda el audio. */
  setWaitMode(on: boolean): void {
    if (this.disposed || on === this.engine.isWaitMode) return
    this.engine.setWaitMode(on)
    this.emitPractice()
  }

  private handleWait(wait: WaitState | null): void {
    if (this.disposed) return
    if (wait) {
      // Detenida justo en la nota (el frame pudo llegar unos ms tarde)
      if (this.player.isPlaying) this.player.pause()
      this.player.seek(wait.t)
    } else if (this.engine.phase === 'running' && !this.player.isPlaying) {
      // Se tocó lo que faltaba: sigue sin cuenta previa
      this.player.play()
    }
    this.emitPractice()
  }

  private emitPractice(): void {
    if (this.disposed) return
    this.practiceSnapshot = this.buildPractice()
    this.practiceListeners.forEach(listener => listener())
  }

  get clock() {
    return this.player.clock
  }

  get durationS(): number {
    return this.chart.durationS
  }

  /** Sonando, o detenida en una nota del modo espera (la partida sigue en curso). */
  get isPlaying(): boolean {
    return this.player.isPlaying || this.engine.waitState !== null
  }

  async play(): Promise<void> {
    if (this.disposed || this.isPlaying) return
    // El AudioContext nace suspendido hasta un gesto del usuario
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    if (this.engine.phase === 'ended') this.player.seek(0)
    // Cuenta de un compás: el audio arranca después y los clicks caen en el mismo reloj
    const at = this.clock.now()
    const clicks = this.countIn
      ? countInClicks(this.chart.grid, at, this.chart.timeSignature[0])
      : []
    this.player.play(countInLengthS(clicks, at))
    if (clicks.length) this.metronome.countIn(clicks)
    this.engine.start()
    this.playingSince ??= this.perfNow()
    useGameStore.getState().setPhase('playing')
  }

  pause(): void {
    if (this.disposed || !this.isPlaying) return
    // engine.stop suelta la espera; al reanudar se vuelve a detener en la nota
    this.engine.stop()
    if (this.player.isPlaying) this.player.pause()
    this.stopPlayTimer()
    useGameStore.getState().setPhase('paused')
  }

  toggle(): Promise<void> {
    if (this.isPlaying) {
      this.pause()
      return Promise.resolve()
    }
    return this.play()
  }

  /** Mueve audio y engine juntos. Tras el fin, la partida queda en pausa en ese punto. */
  seek(songTime: number): void {
    if (this.disposed) return
    const t = Math.min(Math.max(songTime, 0), this.durationS)
    // Ir a otro sitio fuera del loop lo quita
    const range = this.loopSeconds
    if (range && (t < range.startS || t >= range.endS)) this.setLoop(null)
    this.player.seek(t)
    this.engine.seek(t)
    const store = useGameStore.getState()
    if (store.phase === 'ended' || store.phase === 'idle') store.setPhase('paused')
  }

  setMixLevel(channel: MixChannel, level: number): void {
    this.mixer.setLevel(channel, level)
  }

  applyPreset(preset: MixPreset): void {
    this.mixer.applyPreset(preset)
  }

  setDynamicsBonus(on: boolean): void {
    this.options = { ...this.options, dynamicsBonus: on }
    this.engine.setDynamicsBonus(on)
  }

  /**
   * Segundos reales tocados (sin pausas, con las esperas del modo espera) desde la
   * última llamada: cada partida del historial se lleva solo su parte. Con menos de
   * `minS` devuelve 0 y no consume nada.
   */
  takePlayedSeconds(minS = 0): number {
    if (this.playingSince !== null) {
      const now = this.perfNow()
      this.playedMs += now - this.playingSince
      this.playingSince = now
    }
    const seconds = this.playedMs / 1000
    // Un rato muy corto no se lleva: se suma al siguiente
    if (seconds < minS) return 0
    this.playedMs = 0
    return seconds
  }

  private stopPlayTimer(): void {
    if (this.playingSince === null) return
    this.playedMs += this.perfNow() - this.playingSince
    this.playingSince = null
  }

  dispose(): void {
    if (this.disposed) return
    this.stopPlayTimer()
    this.disposed = true
    this.tempoJob?.abort()
    this.practiceListeners.clear()
    this.unsubs.forEach(unsub => unsub())
    this.unbindScoring()
    this.engine.stop()
    this.metronome.dispose()
    this.kit.dispose()
    this.player.dispose()
    this.mixer.dispose()
    void this.ctx.close()
    useGameStore.getState().reset()
  }
}

function silentBuffer(ctx: SessionContext, durationS: number): AudioBuffer {
  const length = Math.max(1, Math.ceil(durationS * SILENT_SAMPLE_RATE))
  return ctx.createBuffer(1, length, SILENT_SAMPLE_RATE)
}

function defaultContext(): SessionContext {
  return new AudioContext({ latencyHint: 'interactive' })
}

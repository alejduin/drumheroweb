import type { ChartSection, ChartV2, Difficulty, Level, MidiHit, WaveformPeaks } from '@/types'
import { Mixer } from '@/audio/Mixer'
import type { MixChannel, MixLevels, MixPreset, MixerContext } from '@/audio/Mixer'
import { createSongPlayer } from '@/audio/StemPlayer'
import type { PlayerContext, StemPlayer } from '@/audio/StemPlayer'
import { loadSongAudio } from '@/audio/loadSongAudio'
import { createKitBuffers } from '@/audio/drumSynth'
import { stretchBuffers, stretchInWorker } from '@/audio/tempo'
import type { StretchBufferContext, StretchFn } from '@/audio/tempo'
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
import { effectiveSections } from './sections'
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
}

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

  private constructor(
    ctx: SessionContext,
    bundle: SongBundle,
    audio: SongAudio | null,
    options: SessionOptions,
    deps: SessionDeps,
  ) {
    this.ctx = ctx
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

    // Clicks en el canal "metronome" del mezclador; se realinea solo al pausar o hacer seek
    this.metronome = new Metronome({
      ctx,
      clock: this.player.clock,
      grid: this.chart.grid,
      output: this.mixer.input('metronome'),
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
    const { level, latencyMs, dynamicsBonus } = this.options
    this.engine.load(this.chart, difficulty, { level, latencyMs, dynamicsBonus })
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
    const position = this.clock.now()
    this.pause()
    this.options = { ...this.options, difficulty }
    this.unbindScoring()
    this.unbindScoring = this.loadNotes(difficulty)
    this.kit.setNotes(this.engine.chartNotes)
    this.seek(position)
  }

  /** Tempo pedido (0,5–1). Mientras se prepara, la canción sigue al tempo anterior. */
  get tempo(): number {
    return this.targetTempo
  }

  /**
   * Cambia el tempo sin cambiar el tono (PLAN_V2 D2). Las pistas se estiran en un
   * worker (unos segundos) y, al terminar, la canción sigue desde la misma posición
   * al nuevo tempo; mientras tanto suena como antes. Un cambio nuevo cancela el que
   * estaba en curso. Resuelve true si se aplicó, false si otro cambio lo reemplazó.
   */
  async setTempo(tempo: number): Promise<boolean> {
    if (this.disposed) return false
    const rate = normalizeTempo(tempo)
    this.tempoJob?.abort()
    this.tempoJob = null
    this.targetTempo = rate
    if (rate === this.player.playbackRate) return true

    // Sin música (pista silenciosa) no hay tono que conservar
    if (rate === 1 || this.audioMode === 'silent') {
      this.player.setTempo(rate, null)
      return true
    }
    const job = new AbortController()
    this.tempoJob = job
    try {
      const buffers = await stretchBuffers(
        this.ctx,
        this.trackBuffers,
        rate,
        this.stretch,
        job.signal,
      )
      if (job.signal.aborted || this.disposed) return false
      this.player.setTempo(rate, buffers)
      return true
    } catch (error) {
      if (job.signal.aborted || this.disposed) return false
      // Si falla, se queda en el tempo que estaba sonando
      this.targetTempo = this.player.playbackRate
      throw error
    } finally {
      if (this.tempoJob === job) this.tempoJob = null
    }
  }

  get clock() {
    return this.player.clock
  }

  get durationS(): number {
    return this.chart.durationS
  }

  get isPlaying(): boolean {
    return this.player.isPlaying
  }

  async play(): Promise<void> {
    if (this.disposed || this.player.isPlaying) return
    // El AudioContext nace suspendido hasta un gesto del usuario
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    if (this.engine.phase === 'ended') this.player.seek(0)
    this.player.play()
    this.engine.start()
    useGameStore.getState().setPhase('playing')
  }

  pause(): void {
    if (this.disposed || !this.player.isPlaying) return
    this.player.pause()
    this.engine.stop()
    useGameStore.getState().setPhase('paused')
  }

  toggle(): Promise<void> {
    if (this.player.isPlaying) {
      this.pause()
      return Promise.resolve()
    }
    return this.play()
  }

  /** Mueve audio y engine juntos. Tras el fin, la partida queda en pausa en ese punto. */
  seek(songTime: number): void {
    if (this.disposed) return
    const t = Math.min(Math.max(songTime, 0), this.durationS)
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

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.tempoJob?.abort()
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

import type { ChartSection, ChartV2, Difficulty, Level, MidiHit, WaveformPeaks } from '@/types'
import { Mixer } from '@/audio/Mixer'
import type { MixChannel, MixLevels, MixPreset, MixerContext } from '@/audio/Mixer'
import { createSongPlayer } from '@/audio/StemPlayer'
import type { PlayerContext, StemPlayer } from '@/audio/StemPlayer'
import { loadSongAudio } from '@/audio/loadSongAudio'
import type { DecodeContext, SongAudio, SongAudioSources } from '@/audio/loadSongAudio'
import { GameEngine } from '@/engine/GameEngine'
import type { FrameScheduler } from '@/engine/GameEngine'
import { Metronome } from '@/engine/Metronome'
import type { MetronomeContext } from '@/engine/Metronome'
import { ScoreManager } from '@/scoring/ScoreManager'
import { bindScoring, useGameStore } from '@/store/gameStore'
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
  extends PlayerContext, MixerContext, DecodeContext, MetronomeContext {
  readonly state: AudioContextState
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer
  resume(): Promise<void>
  close(): Promise<void>
}

export interface SessionDeps {
  createContext?: () => SessionContext
  /** Golpes del kit (midiManager.onHit en la app). */
  subscribeHits: (callback: (hit: MidiHit) => void) => () => void
  scheduler?: FrameScheduler
  perfNow?: () => number
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
  readonly peaks: WaveformPeaks
  readonly audioMode: AudioMode
  readonly fallbackReason: string | null
  readonly fileName: string | null

  private readonly ctx: SessionContext
  private readonly unsubs: Array<() => void>
  private disposed = false

  private constructor(
    ctx: SessionContext,
    bundle: SongBundle,
    audio: SongAudio | null,
    options: SessionOptions,
    deps: SessionDeps,
  ) {
    this.ctx = ctx
    this.chart = bundle.chart
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

    this.player = createSongPlayer(ctx, song, this.mixer, deps.perfNow)
    this.engine = new GameEngine({
      clock: this.player.clock,
      transport: this.player,
      scheduler: deps.scheduler,
    })
    this.engine.load(bundle.chart, options.difficulty, {
      level: options.level,
      latencyMs: options.latencyMs,
      dynamicsBonus: options.dynamicsBonus,
    })

    const scoring = new ScoreManager({
      notes: this.engine.chartNotes,
      grid: bundle.chart.grid,
      sections: this.sections,
    })
    this.unsubs = [
      bindScoring(this.engine, scoring),
      deps.subscribeHits(hit => this.engine.handleHit(hit)),
    ]
    // Si el audio acaba antes que el chart, el engine no llegaría a durationS
    this.player.onEnded(() => this.engine.finish())

    // Clicks en el canal "metronome" del mezclador; se realinea solo al pausar o hacer seek
    this.metronome = new Metronome({
      ctx,
      clock: this.player.clock,
      grid: bundle.chart.grid,
      output: this.mixer.input('metronome'),
      scheduler: deps.scheduler,
    })
    this.metronome.start()
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
    this.engine.setDynamicsBonus(on)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubs.forEach(unsub => unsub())
    this.engine.stop()
    this.metronome.dispose()
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

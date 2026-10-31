import type { AudioClock } from '@/audio/AudioClock'
import {
  CORRECTION_COOLDOWN_MS,
  DriftCorrector,
  VideoTimeEstimator,
  computeDrift,
  videoTimeFor,
} from './sync'
import type { VideoState } from './sync'

/** Lo que el SyncManager necesita del reproductor (YouTubePlayer o un fake en tests). */
export interface VideoPlayer {
  currentTime(): number
  state(): VideoState
  play(): void
  pause(): void
  seekTo(seconds: number): void
  setPlaybackRate(rate: number): void
  /** Se llama en cada tick: el video nunca suena (CLAUDE.md, regla 3). */
  ensureMuted(): void
}

export type SyncClock = Pick<AudioClock, 'now' | 'isPlaying' | 'playbackRate' | 'epoch'>

export interface SyncStats {
  /** Última deriva medida (ms); null mientras el video no reproduce. */
  driftMs: number | null
  /** Mayor |deriva| medida con el video reproduciendo, fuera del enfriamiento. */
  maxAbsDriftMs: number
  corrections: number
}

/**
 * SyncManager — hace que el video siga al reloj del MP3. Se llama `tick()` en cada
 * requestAnimationFrame: sigue play/pausa, seek (cambio de `epoch`) y velocidad del
 * reloj, y corrige con seekTo si la deriva supera DRIFT_CORRECT_MS.
 */
export class SyncManager {
  private readonly estimator = new VideoTimeEstimator()
  private readonly corrector = new DriftCorrector()
  private epoch = NaN
  private rate = NaN
  private lastSeekMs = -Infinity
  private stats: SyncStats = { driftMs: null, maxAbsDriftMs: 0, corrections: 0 }

  private readonly player: VideoPlayer
  private readonly clock: SyncClock
  private offsetMs: number

  constructor(player: VideoPlayer, clock: SyncClock, offsetMs: number) {
    this.player = player
    this.clock = clock
    this.offsetMs = offsetMs
  }

  setOffset(offsetMs: number): void {
    this.offsetMs = offsetMs
    this.epoch = NaN // realinea en el próximo tick
  }

  getStats(): SyncStats {
    return { ...this.stats }
  }

  tick(perfMs: number): void {
    const { player, clock } = this
    player.ensureMuted()
    const state = player.state()
    if (state === 'unstarted') return // aún sin cargar: el primer tick tras cargar alinea

    if (clock.playbackRate !== this.rate) {
      this.rate = clock.playbackRate
      player.setPlaybackRate(this.rate)
    }

    const target = videoTimeFor(clock.now(), this.offsetMs)
    const before = target < 0 // la canción empieza antes que el video

    // Seek, play o pausa del reloj: alinear sin esperar a medir deriva
    if (clock.epoch !== this.epoch) {
      this.epoch = clock.epoch
      this.seek(Math.max(target, 0), perfMs)
    }

    const shouldPlay = clock.isPlaying && !before
    if (!shouldPlay) {
      if (state === 'playing' || state === 'buffering') player.pause()
      if (before) this.stats.driftMs = null
      return
    }
    if (state === 'ended') return
    if (state !== 'playing') {
      if (state !== 'buffering') player.play()
      this.stats.driftMs = null
      return
    }

    const videoS = this.estimator.sample(player.currentTime(), perfMs, true, this.rate)
    const drift = computeDrift(videoS, clock.now(), this.offsetMs)
    this.stats.driftMs = drift
    if (this.corrector.shouldCorrect(drift, perfMs)) {
      this.stats.corrections++
      this.estimator.reset()
      this.lastSeekMs = perfMs
      player.seekTo(target)
    } else if (perfMs - this.lastSeekMs >= CORRECTION_COOLDOWN_MS) {
      this.stats.maxAbsDriftMs = Math.max(this.stats.maxAbsDriftMs, Math.abs(drift))
    }
  }

  private seek(videoS: number, perfMs: number): void {
    this.estimator.reset()
    this.corrector.corrected(perfMs)
    this.lastSeekMs = perfMs
    this.player.seekTo(videoS)
  }
}

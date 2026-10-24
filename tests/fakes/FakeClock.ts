import type { SongClock } from '@/audio/AudioClock'

/**
 * Reloj de canción controlable. `perfToSong` traduce con un ancla fija:
 * perfMs = perfAtZero + songTime * 1000 (a rate 1), así un test puede
 * fabricar timestamps MIDI con `perfAt(songTime)`.
 */
export class FakeClock implements SongClock {
  time = 0
  playing = true
  playbackRate = 1
  perfAtZero = 1000

  get isPlaying(): boolean {
    return this.playing
  }

  now(): number {
    return this.time
  }

  perfToSong(perfMs: number): number {
    return ((perfMs - this.perfAtZero) / 1000) * this.playbackRate
  }

  /** Timestamp performance.now() de un instante de canción. */
  perfAt(songTime: number): number {
    return this.perfAtZero + (songTime / this.playbackRate) * 1000
  }
}

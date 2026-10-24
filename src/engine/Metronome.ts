/**
 * Metronome — metrónomo basado en Web Audio API pura.
 *
 * Patrón: scheduler lookahead (Chris Wilson, 2013).
 * - Un setInterval de 25ms actúa como driver del scheduler.
 * - Se programan clicks con audioCtx.currentTime + lookahead (100ms).
 * - La precisión del timing la da el reloj de hardware del AudioContext,
 *   no el setInterval (que solo sirve para disparar el scheduler).
 *
 * Esto evita cualquier advertencia de Tone.js y añade latencia mínima.
 */
export class Metronome {
  private audioCtx: AudioContext | null = null
  private schedulerId: ReturnType<typeof setInterval> | null = null
  private nextBeatTime = 0
  private beat = 0
  private bpm = 120
  private volume = 0.7

  // Tiempo de anticipación en segundos para programar clicks
  private static readonly LOOKAHEAD_S = 0.1
  // Intervalo del scheduler en ms
  private static readonly SCHEDULER_INTERVAL_MS = 25

  /**
   * Inicia el metrónomo. Debe llamarse dentro de un handler de evento de usuario
   * para que el navegador permita crear el AudioContext.
   */
  async start(bpm: number, volume = 0.7): Promise<void> {
    this.stop()

    this.audioCtx = new AudioContext()
    this.bpm = bpm
    this.volume = volume
    this.beat = 0
    // Pequeño delay inicial para evitar click inmediato al arrancar
    this.nextBeatTime = this.audioCtx.currentTime + 0.05

    this.schedulerId = setInterval(() => this.schedule(), Metronome.SCHEDULER_INTERVAL_MS)
  }

  stop(): void {
    if (this.schedulerId !== null) {
      clearInterval(this.schedulerId)
      this.schedulerId = null
    }
    // close() libera los recursos del AudioContext
    this.audioCtx?.close()
    this.audioCtx = null
  }

  setVolume(volume: number): void {
    this.volume = volume
  }

  // ─── Scheduler interno ─────────────────────────────────────────────────────

  private schedule(): void {
    if (!this.audioCtx) return
    const horizon = this.audioCtx.currentTime + Metronome.LOOKAHEAD_S

    while (this.nextBeatTime < horizon) {
      this.scheduleClick(this.nextBeatTime, this.beat)
      this.nextBeatTime += 60 / this.bpm
      this.beat = (this.beat + 1) % 4
    }
  }

  private scheduleClick(time: number, beat: number): void {
    const ctx = this.audioCtx!

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)

    // Beat 0 = acento (tono agudo), beats 1-3 = subdivisions
    osc.frequency.value = beat === 0 ? 880 : 440
    gain.gain.setValueAtTime(this.volume, time)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04)

    osc.start(time)
    osc.stop(time + 0.05)
  }
}

export const metronome = new Metronome()

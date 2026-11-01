// ─── Pase de rendimiento (PLAN_V2 D8, REQUIREMENTS_V2 §10) ────────────────────
// Mide en la partida real, con el kit, los tres objetivos no funcionales:
//  - 60 fps sostenidos en el canvas (intervalo entre frames y trabajo de pintado);
//  - < 5 ms desde el evento MIDI hasta la calificación (performance.now() −
//    MIDIMessageEvent.timeStamp al terminar handleHit);
//  - < 10 ms de desfase partitura–audio: la partitura lee el reloj del audio, así
//    que el desfase propio es la fluctuación del reloj frame a frame (lo que la
//    posición se aparta del avance real del tiempo). El resto es la calibración.
// Solo acumula si está activo (ajuste "Mostrar rendimiento"); apagado no cuesta nada.

/** Objetivos de §10. */
export const PERF_TARGETS = {
  fps: 60,
  /** Un frame a 60 Hz más un margen: por encima se cuenta como frame perdido. */
  longFrameMs: 25,
  hitMs: 5,
  driftMs: 10,
} as const

/** Muestras que se conservan de cada métrica (unos 8 s de frames a 60 Hz). */
export const PERF_SAMPLES = 512
/** Saltos del reloj mayores a esto son un seek o un loop, no fluctuación. */
const CLOCK_JUMP_MS = 100
/** Pausas del RAF mayores a esto (pestaña oculta) no son frames lentos. */
const FRAME_GAP_MS = 500

/** Búfer circular de números con percentiles. */
class Samples {
  private readonly values: Float64Array
  private count = 0
  private next = 0

  constructor(size: number) {
    this.values = new Float64Array(size)
  }

  push(v: number): void {
    this.values[this.next] = v
    this.next = (this.next + 1) % this.values.length
    this.count = Math.min(this.count + 1, this.values.length)
  }

  clear(): void {
    this.count = 0
    this.next = 0
  }

  get size(): number {
    return this.count
  }

  stats(): SampleStats | null {
    if (this.count === 0) return null
    const sorted = Array.from(this.values.subarray(0, this.count)).sort((a, b) => a - b)
    const sum = sorted.reduce((s, v) => s + v, 0)
    const at = (q: number) => sorted[Math.min(Math.ceil(q * sorted.length) - 1, sorted.length - 1)]
    return {
      count: this.count,
      mean: sum / this.count,
      p95: at(0.95),
      max: sorted[sorted.length - 1],
    }
  }

  countAbove(limit: number): number {
    let n = 0
    for (let i = 0; i < this.count; i++) if (this.values[i] > limit) n++
    return n
  }
}

export interface SampleStats {
  count: number
  mean: number
  p95: number
  max: number
}

export interface PerfSummary {
  /** Frames por segundo según el intervalo medio entre frames. */
  fps: number | null
  /** Intervalo entre frames (ms). */
  frame: SampleStats | null
  /** Trabajo de pintado de la partitura por frame (ms). */
  paint: SampleStats | null
  /** Frames de más de PERF_TARGETS.longFrameMs entre las muestras. */
  longFrames: number
  /** Evento MIDI → calificación (ms). */
  hit: SampleStats | null
  /** Fluctuación del reloj de la partitura frente al tiempo real (ms, valor absoluto). */
  drift: SampleStats | null
}

export class PerfMonitor {
  enabled = false
  private readonly frames = new Samples(PERF_SAMPLES)
  private readonly paints = new Samples(PERF_SAMPLES)
  private readonly hits = new Samples(PERF_SAMPLES)
  private readonly drifts = new Samples(PERF_SAMPLES)
  private lastFrameMs: number | null = null
  private lastClock: { perfMs: number; songS: number } | null = null

  /** Un frame de la partitura: instante (performance.now()) y lo que tardó en pintar. */
  frame(nowMs: number, paintMs: number): void {
    if (!this.enabled) return
    if (this.lastFrameMs !== null) {
      const interval = nowMs - this.lastFrameMs
      if (interval > 0 && interval < FRAME_GAP_MS) this.frames.push(interval)
    }
    this.lastFrameMs = nowMs
    this.paints.push(paintMs)
  }

  /**
   * Lectura del reloj en un frame: posición de la canción `songS` en el instante
   * `perfMs`. Entre dos lecturas con el reloj en marcha, la posición debería avanzar
   * lo mismo que el tiempo real × tempo; la diferencia es la fluctuación.
   */
  clock(perfMs: number, songS: number, rate: number, playing: boolean): void {
    if (!this.enabled) return
    if (!playing) {
      this.lastClock = null
      return
    }
    const last = this.lastClock
    this.lastClock = { perfMs, songS }
    if (!last || rate <= 0) return
    const dPerf = perfMs - last.perfMs
    if (dPerf <= 0 || dPerf > FRAME_GAP_MS) return
    const error = Math.abs(((songS - last.songS) * 1000) / rate - dPerf)
    if (error > CLOCK_JUMP_MS) return
    this.drifts.push(error)
  }

  /** Un golpe calificado: ms desde su MIDIMessageEvent.timeStamp. */
  hit(latencyMs: number): void {
    if (!this.enabled) return
    this.hits.push(Math.max(latencyMs, 0))
  }

  reset(): void {
    for (const s of [this.frames, this.paints, this.hits, this.drifts]) s.clear()
    this.lastFrameMs = null
    this.lastClock = null
  }

  summary(): PerfSummary {
    const frame = this.frames.stats()
    return {
      fps: frame ? 1000 / frame.mean : null,
      frame,
      paint: this.paints.stats(),
      longFrames: this.frames.countAbove(PERF_TARGETS.longFrameMs),
      hit: this.hits.stats(),
      drift: this.drifts.stats(),
    }
  }
}

/** El monitor de la app (lo alimentan la partitura y la sesión). */
export const perfMonitor = new PerfMonitor()

export interface PerfLine {
  label: string
  value: string
  ok: boolean | null
}

const ms = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`

/** Las tres líneas del panel: valor y si cumple el objetivo (null = sin datos). */
export function perfLines(s: PerfSummary): PerfLine[] {
  return [
    {
      label: 'Render',
      value:
        s.fps === null || !s.frame || !s.paint
          ? '—'
          : `${Math.round(s.fps)} fps · p95 ${ms(s.frame.p95)} · pintar ${ms(s.paint.p95)} · ${s.longFrames} lentos`,
      // 58 fps de media: el RAF a 60 Hz nunca da exactamente 60
      ok:
        s.fps === null
          ? null
          : s.fps >= PERF_TARGETS.fps - 2 && s.frame!.p95 <= PERF_TARGETS.longFrameMs,
    },
    {
      label: 'Golpe',
      value: s.hit
        ? `p95 ${ms(s.hit.p95)} · máx ${ms(s.hit.max)} · ${s.hit.count} golpes`
        : 'toca el kit',
      ok: s.hit ? s.hit.p95 < PERF_TARGETS.hitMs : null,
    },
    {
      label: 'Reloj',
      value: s.drift ? `fluctuación p95 ${ms(s.drift.p95)} · máx ${ms(s.drift.max)}` : 'dale play',
      ok: s.drift ? s.drift.p95 < PERF_TARGETS.driftMs : null,
    },
  ]
}

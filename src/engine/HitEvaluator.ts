import {
  ACCENT_MIN_VELOCITY,
  DYNAMIC_BONUS_POINTS,
  GHOST_MAX_VELOCITY,
  LEVEL_POINTS,
  LEVEL_WINDOWS,
} from '@/constants/scoring'
import type { HitWindows, JudgementPoints } from '@/constants/scoring'
import type {
  ChartNote,
  HitJudgement,
  Level,
  MissJudgement,
  Piece,
  PlayedHit,
  Timing,
} from '@/types'
import { noteDynamic } from '@/chart/notes'

// ─── V2 ───────────────────────────────────────────────────────────────────────

// Tolerancia para que los límites sean inclusivos pese a la coma flotante (s → ms)
const BOUNDARY_EPSILON_MS = 1e-6

export interface HitEvaluatorOptions {
  level: Level
  /** Latencia del kit (calibración, ms): se resta al tiempo de cada golpe. */
  latencyMs?: number
  /** +DYNAMIC_BONUS_POINTS por ghost < 50 o acento > 100 (PLAN_V2 D3). */
  dynamicsBonus?: boolean
}

/** Perfecto o Cerca según |delta| con límites inclusivos; null = fuera de la ventana. */
export function classifyDelta(deltaMs: number, windows: HitWindows): 'perfect' | 'close' | null {
  const abs = Math.abs(deltaMs)
  if (abs <= windows.perfectMs + BOUNDARY_EPSILON_MS) return 'perfect'
  if (abs <= windows.closeMs + BOUNDARY_EPSILON_MS) return 'close'
  return null
}

export function timingOf(deltaMs: number): Timing {
  if (deltaMs < 0) return 'early'
  if (deltaMs > 0) return 'late'
  return 'on_time'
}

/** Si la velocity respeta la dinámica marcada (ghost suave, acento fuerte). */
export function respectsDynamic(note: ChartNote, velocity: number): boolean {
  const dynamic = noteDynamic(note)
  if (dynamic === 'ghost') return velocity < GHOST_MAX_VELOCITY
  if (dynamic === 'accent') return velocity > ACCENT_MIN_VELOCITY
  return false
}

/** Primer índice de `indices` cuya nota tiene t >= x (búsqueda binaria). */
function lowerBound(notes: readonly ChartNote[], indices: readonly number[], x: number): number {
  let lo = 0
  let hi = indices.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (notes[indices[mid]].t < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

const NOT_JUDGED = 0
const JUDGED = 1
const SKIPPED = 2 // anterior a un seek: ni se acierta ni cuenta como Fallo

/**
 * Evalúa golpes contra las notas de una dificultad (ordenadas por t, invariante del chart).
 *
 * - Un golpe acierta la nota pendiente **de la misma pieza** más cercana dentro de la
 *   ventana Cerca del nivel (el hi-hat de pie es una pieza más y cuenta).
 * - Si no hay ninguna, es pad incorrecto: solo feedback, no consume notas.
 * - `expire(now)` convierte en Fallo las notas cuya ventana ya cerró.
 *
 * Puro y sin reloj: el GameEngine le pasa los golpes ya convertidos a segundos de canción
 * (MIDIMessageEvent.timeStamp → clock.perfToSong) y el tiempo actual para expirar.
 * El engine debe procesar los golpes recibidos antes de expirar en cada frame.
 *
 * Con otro tempo (D2) las ventanas y la latencia se miden en tiempo real, no de
 * canción: a 50 % una ventana de ±30 ms abarca ±15 ms de canción, y los deltaMs
 * de los juicios son los milisegundos que el usuario se adelantó o atrasó.
 */
export class HitEvaluator {
  readonly windows: HitWindows
  private readonly points: JudgementPoints
  private readonly latencyS: number
  private dynamicsBonus: boolean
  /** Tempo de reproducción (1 = normal): segundos de canción por segundo real. */
  private rate = 1
  private readonly notes: readonly ChartNote[]
  private readonly allIndices: readonly number[]
  private readonly byPiece = new Map<Piece, number[]>()
  private readonly state: Uint8Array
  private expireCursor = 0

  constructor(notes: readonly ChartNote[], options: HitEvaluatorOptions) {
    this.notes = notes
    this.windows = LEVEL_WINDOWS[options.level]
    this.points = LEVEL_POINTS[options.level]
    this.latencyS = (options.latencyMs ?? 0) / 1000
    this.dynamicsBonus = options.dynamicsBonus ?? false
    this.state = new Uint8Array(notes.length)
    this.allIndices = notes.map((_, i) => i)
    notes.forEach((note, i) => {
      const list = this.byPiece.get(note.piece)
      if (list) list.push(i)
      else this.byPiece.set(note.piece, [i])
    })
  }

  /** Activa o quita los puntos por dinámica para los golpes siguientes. */
  setDynamicsBonus(on: boolean): void {
    this.dynamicsBonus = on
  }

  /** Tempo de reproducción actual (lo sincroniza el GameEngine con el reloj). */
  setRate(rate: number): void {
    if (!(rate > 0)) throw new RangeError(`rate inválido: ${rate}`)
    this.rate = rate
  }

  /** Ventana Cerca en segundos de canción al tempo actual. */
  get closeWindowS(): number {
    return (this.windows.closeMs * this.rate) / 1000
  }

  judge(hit: PlayedHit): HitJudgement {
    const t = hit.t - this.latencyS * this.rate
    const index = this.closestPending(this.byPiece.get(hit.piece) ?? [], t)

    if (index === null) {
      const expected = this.closestPending(this.allIndices, t)
      return {
        judgement: 'wrong_pad',
        piece: hit.piece,
        expectedPiece: expected === null ? null : this.notes[expected].piece,
        velocity: hit.velocity,
      }
    }

    const note = this.notes[index]
    const deltaMs = this.realDeltaMs(t, note.t)
    const judgement = classifyDelta(deltaMs, this.windows)!
    this.state[index] = JUDGED
    return {
      judgement,
      noteIndex: index,
      piece: note.piece,
      deltaMs,
      timing: timingOf(deltaMs),
      points: this.points[judgement],
      dynamicBonus:
        this.dynamicsBonus && respectsDynamic(note, hit.velocity) ? DYNAMIC_BONUS_POINTS : 0,
      velocity: hit.velocity,
    }
  }

  /** Fallos de las notas cuya ventana Cerca terminó antes de `songT` (en orden). */
  expire(songT: number): MissJudgement[] {
    const misses: MissJudgement[] = []
    // Un golpe que llegue ahora se evalúa en songT − latencia: hasta ahí sigue abierta la ventana
    const limitMs =
      (songT - this.latencyS * this.rate) * 1000 -
      (this.windows.closeMs + BOUNDARY_EPSILON_MS) * this.rate
    while (this.expireCursor < this.notes.length) {
      const index = this.expireCursor
      const note = this.notes[index]
      if (note.t * 1000 >= limitMs) break
      if (this.state[index] === NOT_JUDGED) {
        this.state[index] = JUDGED
        misses.push({ judgement: 'miss', noteIndex: index, piece: note.piece })
      }
      this.expireCursor++
    }
    return misses
  }

  /** Reinicia tras un seek: las notas anteriores a `songT` se saltan, el resto queda pendiente. */
  seek(songT: number): void {
    this.expireCursor = 0
    this.notes.forEach((note, i) => {
      this.state[i] = note.t < songT ? SKIPPED : NOT_JUDGED
    })
  }

  isPending(noteIndex: number): boolean {
    return this.state[noteIndex] === NOT_JUDGED
  }

  /** Índice de la nota pendiente más cercana a t dentro de la ventana Cerca (empate: la anterior). */
  private closestPending(indices: readonly number[], t: number): number | null {
    const windowS = ((this.windows.closeMs + BOUNDARY_EPSILON_MS) * this.rate) / 1000
    let best: number | null = null
    let bestDistance = Infinity
    for (let k = lowerBound(this.notes, indices, t - windowS); k < indices.length; k++) {
      const index = indices[k]
      const distance = Math.abs(this.notes[index].t - t)
      if (this.notes[index].t > t + windowS) break
      if (this.state[index] !== NOT_JUDGED) continue
      if (distance < bestDistance) {
        best = index
        bestDistance = distance
      }
    }
    if (best === null) return null
    // La búsqueda va en segundos; la clasificación en ms decide el límite exacto
    return classifyDelta(this.realDeltaMs(t, this.notes[best].t), this.windows) ? best : null
  }

  /** Distancia golpe − nota en milisegundos reales al tempo actual. */
  private realDeltaMs(hitT: number, noteT: number): number {
    return ((hitT - noteT) * 1000) / this.rate
  }
}

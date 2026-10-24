import type { Timing } from '@/types'
import type { TimedJudgement } from '@/engine/GameEngine'

/** Cómo se pinta una nota: aún sin tocar o con su juicio (PLAN_V2 §4.3). */
export type NoteVisualState = 'future' | 'perfect' | 'close' | 'miss'

const STATES: readonly NoteVisualState[] = ['future', 'perfect', 'close', 'miss']
const TIMINGS: readonly Timing[] = ['early', 'on_time', 'late']

/**
 * Estado visual por nota, alimentado por los juicios del GameEngine.
 * Arrays tipados: se consulta por cada nota visible en cada frame sin crear objetos.
 */
export class NoteStates {
  private states: Uint8Array
  private timings: Uint8Array

  constructor(noteCount: number) {
    this.states = new Uint8Array(noteCount)
    this.timings = new Uint8Array(noteCount)
  }

  get size(): number {
    return this.states.length
  }

  apply(j: TimedJudgement): void {
    if (j.judgement === 'wrong_pad') return // feedback gris en la línea, la nota sigue pendiente
    this.states[j.noteIndex] = STATES.indexOf(j.judgement)
    this.timings[j.noteIndex] = j.judgement === 'miss' ? 0 : TIMINGS.indexOf(j.timing) + 1
  }

  /** Tras un seek o una vuelta del loop: solo los juicios que siguen vigentes. */
  rebuild(log: readonly TimedJudgement[]): void {
    this.states.fill(0)
    this.timings.fill(0)
    for (const j of log) this.apply(j)
  }

  /** Cambia de chart o de dificultad. */
  resize(noteCount: number): void {
    this.states = new Uint8Array(noteCount)
    this.timings = new Uint8Array(noteCount)
  }

  stateOf(noteIndex: number): NoteVisualState {
    return STATES[this.states[noteIndex]] ?? 'future'
  }

  /** Temprano / a tiempo / tarde de un acierto; null si no se tocó. */
  timingOf(noteIndex: number): Timing | null {
    const code = this.timings[noteIndex]
    return code === 0 ? null : TIMINGS[code - 1]
  }
}

/** Fuente de estados de un frame (NoteStates o un fake en tests). */
export type NoteStateSource = Pick<NoteStates, 'stateOf' | 'timingOf'>

/** Todas las notas por tocar (vista previa, editor). */
export const ALL_FUTURE: NoteStateSource = { stateOf: () => 'future', timingOf: () => null }

import { TIMING_TREND_HITS, multiplierFor } from '@/constants/scoring'
import type { Multiplier } from '@/constants/scoring'
import type { ChartGrid, ChartNote, ChartSection, Judgement } from '@/types'
import { measureAt } from '@/chart/grid'
import type { TimedJudgement } from '@/engine/GameEngine'
import { PIECE_GROUPS, PIECE_GROUP_OF } from './pieceGroups'
import type { PieceGroup } from './pieceGroups'

/** Conteo de notas evaluadas (pad incorrecto no cuenta, PLAN_V2 D2). */
export interface Tally {
  perfect: number
  close: number
  miss: number
}

/** (Perfecto + Cerca) / notas evaluadas (PLAN_V2 D11); null si no se evaluó ninguna. */
export function precisionOf(tally: Tally): number | null {
  const evaluated = tally.perfect + tally.close + tally.miss
  return evaluated === 0 ? null : (tally.perfect + tally.close) / evaluated
}

const emptyTally = (): Tally => ({ perfect: 0, close: 0, miss: 0 })

export interface ComboRun {
  count: number
  startT: number // nota del primer golpe del combo
  endT: number // nota del último
  startMeasure: number
  endMeasure: number
}

/** Lo que muestra el HUD; cambia solo con cada juicio. */
export interface ScoreSnapshot {
  score: number
  combo: number
  multiplier: Multiplier
  bestCombo: number
  counts: Tally & { wrongPad: number }
  precision: number | null
  /** Media del delta (ms) de los últimos TIMING_TREND_HITS aciertos; < 0 = temprano. */
  timingTrendMs: number | null
  last: TimedJudgement | null
}

export interface MeasureStats {
  measure: number
  tally: Tally
  precision: number | null
}

export interface SectionStats {
  name: string
  startMeasure: number
  endMeasure: number
  tally: Tally
  precision: number | null
}

/** Estadísticas completas de la partida (pantalla de Resultados). */
export interface ScoreResults extends ScoreSnapshot {
  bestComboRun: ComboRun | null
  /** Media del delta (ms) de todos los aciertos. */
  meanDeltaMs: number | null
  byGroup: Record<PieceGroup, Tally & { precision: number | null }>
  byMeasure: MeasureStats[] // solo los compases con notas evaluadas, en orden
  bySection: SectionStats[]
}

export interface ScoreContext {
  notes: readonly ChartNote[]
  grid: ChartGrid
  sections: readonly ChartSection[]
}

/**
 * ScoreManager v2 — acumula los juicios del GameEngine: puntos × combo, precisión,
 * agregados por pieza, compás y sección, mejor combo y tendencia de timing.
 *
 * Los juicios se aplican en orden de llegada (el mismo del registro del engine), así
 * que `rebuild(engine.judgements)` tras un seek da exactamente el mismo estado.
 */
export class ScoreManager {
  private readonly ctx: ScoreContext
  private readonly measureOfNote: readonly number[]

  private score = 0
  private combo = 0
  private comboStart: { t: number; measure: number } | null = null
  private best: ComboRun | null = null
  private counts = emptyTally()
  private wrongPad = 0
  private deltas: number[] = []
  private last: TimedJudgement | null = null
  private byGroup = new Map<PieceGroup, Tally>()
  private byMeasure = new Map<number, Tally>()

  constructor(ctx: ScoreContext) {
    this.ctx = ctx
    this.measureOfNote = ctx.notes.map(n => measureAt(ctx.grid, n.t))
  }

  apply(j: TimedJudgement): void {
    this.last = j
    if (j.judgement === 'wrong_pad') {
      this.wrongPad++
      return
    }

    const measure = this.measureOfNote[j.noteIndex]
    this.count(j.judgement, PIECE_GROUP_OF[j.piece], measure)

    if (j.judgement === 'miss') {
      this.combo = 0
      this.comboStart = null
      return
    }

    this.combo++
    this.comboStart ??= { t: j.t, measure }
    this.score += (j.points + j.dynamicBonus) * multiplierFor(this.combo)
    this.deltas.push(j.deltaMs)
    if (!this.best || this.combo > this.best.count) {
      this.best = {
        count: this.combo,
        startT: this.comboStart.t,
        endT: j.t,
        startMeasure: this.comboStart.measure,
        endMeasure: measure,
      }
    }
  }

  /** Recalcula desde cero (tras un seek o una vuelta del loop). */
  rebuild(judgements: readonly TimedJudgement[]): void {
    this.reset()
    for (const j of judgements) this.apply(j)
  }

  reset(): void {
    this.score = 0
    this.combo = 0
    this.comboStart = null
    this.best = null
    this.counts = emptyTally()
    this.wrongPad = 0
    this.deltas = []
    this.last = null
    this.byGroup.clear()
    this.byMeasure.clear()
  }

  snapshot(): ScoreSnapshot {
    const recent = this.deltas.slice(-TIMING_TREND_HITS)
    return {
      score: this.score,
      combo: this.combo,
      multiplier: multiplierFor(this.combo),
      bestCombo: this.best?.count ?? 0,
      counts: { ...this.counts, wrongPad: this.wrongPad },
      precision: precisionOf(this.counts),
      timingTrendMs: mean(recent),
      last: this.last,
    }
  }

  results(): ScoreResults {
    const byGroup = {} as ScoreResults['byGroup']
    for (const group of PIECE_GROUPS) {
      const tally = this.byGroup.get(group) ?? emptyTally()
      byGroup[group] = { ...tally, precision: precisionOf(tally) }
    }

    const byMeasure = [...this.byMeasure.entries()]
      .sort(([a], [b]) => a - b)
      .map(([measure, tally]) => ({ measure, tally: { ...tally }, precision: precisionOf(tally) }))

    return {
      ...this.snapshot(),
      bestComboRun: this.best ? { ...this.best } : null,
      meanDeltaMs: mean(this.deltas),
      byGroup,
      byMeasure,
      bySection: this.sectionStats(),
    }
  }

  /** Precisión por sección (panel Secciones en vivo y Resultados). */
  sectionStats(): SectionStats[] {
    return this.ctx.sections.map(section => {
      const tally = emptyTally()
      for (const [measure, t] of this.byMeasure) {
        if (measure < section.startMeasure || measure > section.endMeasure) continue
        tally.perfect += t.perfect
        tally.close += t.close
        tally.miss += t.miss
      }
      return { ...section, tally, precision: precisionOf(tally) }
    })
  }

  private count(
    judgement: Exclude<Judgement, 'wrong_pad'>,
    group: PieceGroup,
    measure: number,
  ): void {
    for (const tally of [
      this.counts,
      this.tallyFor(this.byGroup, group),
      this.tallyFor(this.byMeasure, measure),
    ]) {
      tally[judgement]++
    }
  }

  private tallyFor<K>(map: Map<K, Tally>, key: K): Tally {
    let tally = map.get(key)
    if (!tally) {
      tally = emptyTally()
      map.set(key, tally)
    }
    return tally
  }
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Sección que contiene un compás, si hay alguna (p. ej. "en el verso 2"). */
export function sectionForMeasure(
  sections: readonly ChartSection[],
  measure: number,
): ChartSection | null {
  return sections.find(s => measure >= s.startMeasure && measure <= s.endMeasure) ?? null
}

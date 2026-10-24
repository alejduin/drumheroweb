import { afterEach, describe, expect, it } from 'vitest'
import type { TimedJudgement } from '@/engine/GameEngine'
import { ScoreManager } from '@/scoring/ScoreManager'
import {
  EMPTY_SNAPSHOT,
  bindScoring,
  selectCombo,
  selectResults,
  selectScore,
  useGameStore,
} from '@/store/gameStore'
import type { JudgementSource } from '@/store/gameStore'

type Listener<T> = (value: T) => void

/** Engine falso: el test emite los eventos. */
function fakeEngine() {
  const judgement = new Set<Listener<TimedJudgement>>()
  const reset = new Set<Listener<readonly TimedJudgement[]>>()
  const end = new Set<Listener<readonly TimedJudgement[]>>()
  const sub =
    <T>(set: Set<Listener<T>>) =>
    (l: Listener<T>) => {
      set.add(l)
      return () => set.delete(l)
    }
  const engine: JudgementSource = {
    onJudgement: sub(judgement),
    onReset: sub(reset),
    onEnd: sub(end),
  }
  return {
    engine,
    judge: (j: TimedJudgement) => judgement.forEach(l => l(j)),
    reset: (log: TimedJudgement[]) => reset.forEach(l => l(log)),
    end: (log: TimedJudgement[]) => end.forEach(l => l(log)),
    listeners: () => judgement.size + reset.size + end.size,
  }
}

const perfect = (noteIndex: number): TimedJudgement => ({
  judgement: 'perfect',
  noteIndex,
  piece: 'snare',
  deltaMs: 0,
  timing: 'on_time',
  points: 100,
  dynamicBonus: 0,
  velocity: 80,
  t: noteIndex,
})

const notes = Array.from({ length: 5 }, (_, i) => ({
  t: i,
  piece: 'snare' as const,
  velocity: 80,
  confidence: 1,
}))
const grid = { beats: [0, 1, 2, 3, 4], downbeats: [0] }

afterEach(() => useGameStore.getState().reset())

describe('gameStore', () => {
  it('cada juicio actualiza el HUD; los selectores leen valores sueltos', () => {
    const fake = fakeEngine()
    bindScoring(fake.engine, new ScoreManager({ notes, grid, sections: [] }))
    fake.judge(perfect(0))
    fake.judge(perfect(1))
    const state = useGameStore.getState()
    expect(selectScore(state)).toBe(200)
    expect(selectCombo(state)).toBe(2)
    expect(state.hud.last).toEqual(perfect(1))
  })

  it('un seek reconstruye el HUD con los juicios vigentes', () => {
    const fake = fakeEngine()
    bindScoring(fake.engine, new ScoreManager({ notes, grid, sections: [] }))
    ;[0, 1, 2].forEach(i => fake.judge(perfect(i)))
    fake.reset([perfect(0)])
    expect(useGameStore.getState().hud).toMatchObject({ score: 100, combo: 1 })
  })

  it('el fin publica los resultados y pasa a ended', () => {
    const fake = fakeEngine()
    bindScoring(fake.engine, new ScoreManager({ notes, grid, sections: [] }))
    const log = [perfect(0), perfect(1)]
    log.forEach(fake.judge)
    fake.end(log)
    const state = useGameStore.getState()
    expect(state.phase).toBe('ended')
    expect(selectResults(state)).toMatchObject({
      score: 200,
      precision: 1,
      byMeasure: [{ measure: 1 }],
    })
  })

  it('bind reinicia el estado y la desconexión quita las suscripciones', () => {
    useGameStore.setState({ phase: 'playing', hud: { ...EMPTY_SNAPSHOT, score: 999 } })
    const fake = fakeEngine()
    const unbind = bindScoring(fake.engine, new ScoreManager({ notes, grid, sections: [] }))
    expect(useGameStore.getState()).toMatchObject({ phase: 'idle', hud: EMPTY_SNAPSHOT })
    unbind()
    expect(fake.listeners()).toBe(0)
  })
})

import { create } from 'zustand'
import type { GameEngine } from '@/engine/GameEngine'
import { ScoreManager } from '@/scoring/ScoreManager'
import type { ScoreResults, ScoreSnapshot } from '@/scoring/ScoreManager'

// ─── Estado de la partida para la UI ──────────────────────────────────────────
// Se actualiza con cada juicio, nunca por frame (CLAUDE.md, regla 6). El canvas
// lee el reloj y los eventos del engine directamente; React solo pinta el HUD.

export type PlayPhase = 'idle' | 'playing' | 'paused' | 'ended'

export const EMPTY_SNAPSHOT: ScoreSnapshot = {
  score: 0,
  combo: 0,
  multiplier: 1,
  bestCombo: 0,
  counts: { perfect: 0, close: 0, miss: 0, wrongPad: 0 },
  precision: null,
  timingTrendMs: null,
  last: null,
}

interface GameStore {
  phase: PlayPhase
  hud: ScoreSnapshot
  /** Estadísticas completas al terminar la partida. */
  results: ScoreResults | null
  setPhase(phase: PlayPhase): void
  reset(): void
}

export const useGameStore = create<GameStore>(set => ({
  phase: 'idle',
  hud: EMPTY_SNAPSHOT,
  results: null,
  setPhase: phase => set({ phase }),
  reset: () => set({ phase: 'idle', hud: EMPTY_SNAPSHOT, results: null }),
}))

/** Lo que el store necesita del engine (fake en tests). */
export type JudgementSource = Pick<GameEngine, 'onJudgement' | 'onReset' | 'onEnd'>

/**
 * Conecta el engine con el scoring y el store: cada juicio actualiza el HUD, un seek
 * lo reconstruye y el fin publica los resultados. Retorna la función de desconexión.
 */
export function bindScoring(engine: JudgementSource, manager: ScoreManager): () => void {
  const store = useGameStore.getState()
  manager.reset()
  store.reset()

  const publish = () => useGameStore.setState({ hud: manager.snapshot() })
  const unsubs = [
    engine.onJudgement(j => {
      manager.apply(j)
      publish()
    }),
    engine.onReset(judgements => {
      manager.rebuild(judgements)
      useGameStore.setState({ hud: manager.snapshot(), results: null })
    }),
    engine.onEnd(judgements => {
      manager.rebuild(judgements)
      useGameStore.setState({ phase: 'ended', hud: manager.snapshot(), results: manager.results() })
    }),
  ]
  return () => unsubs.forEach(unsub => unsub())
}

// ─── Selectores (un componente se re-renderiza solo si cambia su valor) ───────

type State = Pick<GameStore, 'phase' | 'hud' | 'results'>

export const selectPhase = (s: State) => s.phase
export const selectScore = (s: State) => s.hud.score
export const selectCombo = (s: State) => s.hud.combo
export const selectMultiplier = (s: State) => s.hud.multiplier
export const selectPrecision = (s: State) => s.hud.precision
export const selectTimingTrend = (s: State) => s.hud.timingTrendMs
export const selectLastJudgement = (s: State) => s.hud.last
export const selectResults = (s: State) => s.results

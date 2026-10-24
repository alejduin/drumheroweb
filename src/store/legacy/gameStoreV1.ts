import { create } from 'zustand'
import { gameEngine } from '@/engine/legacy/GameEngineV1'
import { comboSystem } from '@/scoring/legacy/ComboSystemV1'
import { scoreManager } from '@/scoring/legacy/ScoreManagerV1'
import { HitAccuracy } from '@/types'
import type { GamePhase, HitResult, SongData } from '@/types'

interface GameStore {
  // ─── Estado ───────────────────────────────────────────────────────────────
  phase: GamePhase
  song: SongData | null
  /** Duración total de la canción en ms, calculada al cargar. */
  songDurationMs: number
  score: number
  combo: number
  multiplier: 1 | 2 | 3 | 4
  lastAccuracy: HitAccuracy | null
  accuracy: Record<HitAccuracy, number>

  // ─── Acciones ─────────────────────────────────────────────────────────────
  loadSong(song: SongData, latencyOffsetMs?: number): void
  startGame(): void
  pauseGame(): void
  resumeGame(): void
  stopGame(): void
}

// Cleanup de suscripciones al engine (fuera del store para evitar serialización)
let unsubHit: (() => void) | null = null
let unsubEnd: (() => void) | null = null

function cleanupSubs(): void {
  unsubHit?.()
  unsubEnd?.()
  unsubHit = null
  unsubEnd = null
}

function computeSongDurationMs(song: SongData): number {
  const msPerBeat = 60_000 / song.bpm
  const beatsPerMeasure = song.timeSignature[0]
  return song.measures.length * beatsPerMeasure * msPerBeat
}

const INITIAL_ACCURACY: Record<HitAccuracy, number> = {
  perfect: 0,
  great: 0,
  good: 0,
  miss: 0,
}

export const useGameStore = create<GameStore>((set, get) => ({
  phase: 'idle',
  song: null,
  songDurationMs: 0,
  score: 0,
  combo: 0,
  multiplier: 1,
  lastAccuracy: null,
  accuracy: { ...INITIAL_ACCURACY },

  loadSong(song, latencyOffsetMs = 0) {
    cleanupSubs()
    comboSystem.reset()
    scoreManager.reset()
    gameEngine.load(song, latencyOffsetMs)
    set({
      phase: 'idle',
      song,
      songDurationMs: computeSongDurationMs(song),
      score: 0,
      combo: 0,
      multiplier: 1,
      lastAccuracy: null,
      accuracy: { ...INITIAL_ACCURACY },
    })
  },

  startGame() {
    if (!get().song) return
    cleanupSubs()
    comboSystem.reset()
    scoreManager.reset()
    set({
      phase: 'playing',
      score: 0,
      combo: 0,
      multiplier: 1,
      lastAccuracy: null,
      accuracy: { ...INITIAL_ACCURACY },
    })

    unsubHit = gameEngine.onHitResult((result: HitResult) => {
      const { combo, multiplier } = comboSystem.process(result.accuracy)
      const score = scoreManager.applyHit(result, multiplier)
      set({
        score,
        combo,
        multiplier,
        lastAccuracy: result.accuracy,
        accuracy: scoreManager.getAccuracy(),
      })
    })

    unsubEnd = gameEngine.onSongEnd(() => {
      cleanupSubs()
      set({ phase: 'results' })
    })

    gameEngine.start()
  },

  pauseGame() {
    if (get().phase !== 'playing') return
    gameEngine.pause()
    set({ phase: 'paused' })
  },

  resumeGame() {
    if (get().phase !== 'paused') return
    gameEngine.resume()
    set({ phase: 'playing' })
  },

  stopGame() {
    cleanupSubs()
    gameEngine.stop()
    comboSystem.reset()
    scoreManager.reset()
    set({
      phase: 'idle',
      score: 0,
      combo: 0,
      multiplier: 1,
      lastAccuracy: null,
      accuracy: { ...INITIAL_ACCURACY },
    })
  },
}))

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { starsFor } from '@/constants/scoring'
import type { Stars } from '@/constants/scoring'

export interface SongScore {
  songId: string
  score: number
  precision: number | null
  stars: Stars
  playedAt: number // Date.now()
}

interface ProgressStore {
  /** Mejor puntuación por canción (songId → SongScore). */
  bestScores: Record<string, SongScore>

  /** Guarda una partida terminada; solo reemplaza si supera la mejor. B14 lo amplía. */
  saveSongScore(songId: string, score: number, precision: number | null): void

  getBestScore(songId: string): SongScore | null
  clearAll(): void
}

export const useProgressStore = create<ProgressStore>()(
  persist(
    (set, get) => ({
      bestScores: {},

      saveSongScore(songId, score, precision) {
        const existing = get().bestScores[songId]
        if (existing && existing.score >= score) return
        set(state => ({
          bestScores: {
            ...state.bestScores,
            [songId]: {
              songId,
              score,
              precision,
              stars: starsFor(precision),
              playedAt: Date.now(),
            },
          },
        }))
      },

      getBestScore(songId) {
        return get().bestScores[songId] ?? null
      },

      clearAll() {
        set({ bestScores: {} })
      },
    }),
    {
      name: 'drumhero-progress',
      // v1: precisión v2 en lugar del conteo great/good de V1 (las puntuaciones V1 no se comparan)
      version: 1,
      migrate: () => ({ bestScores: {} }) as unknown as ProgressStore,
    },
  ),
)

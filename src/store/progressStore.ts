import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getStars } from '@/constants/game'
import type { HitAccuracy } from '@/types'

export interface SongScore {
  songId: string
  score: number
  stars: 0 | 1 | 2 | 3 | 4 | 5
  accuracy: Record<HitAccuracy, number>
  playedAt: number // Date.now()
}

interface ProgressStore {
  /** Mejor score por canción (songId → SongScore). */
  bestScores: Record<string, SongScore>

  /**
   * Guarda el score de una partida terminada.
   * Solo reemplaza si supera el mejor score existente.
   */
  saveSongScore(songId: string, score: number, accuracy: Record<HitAccuracy, number>): void

  getBestScore(songId: string): SongScore | null
  clearAll(): void
}

export const useProgressStore = create<ProgressStore>()(
  persist(
    (set, get) => ({
      bestScores: {},

      saveSongScore(songId, score, accuracy) {
        const existing = get().bestScores[songId]
        if (existing && existing.score >= score) return

        const total = Object.values(accuracy).reduce((a, b) => a + b, 0)
        const hitRatio = total > 0 ? (total - accuracy.miss) / total : 0
        const stars = getStars(hitRatio)

        set(state => ({
          bestScores: {
            ...state.bestScores,
            [songId]: { songId, score, stars, accuracy, playedAt: Date.now() },
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
    { name: 'drumhero-progress' },
  ),
)

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { starsFor } from '@/constants/scoring'
import type { Stars } from '@/constants/scoring'
import type { SectionPrecision } from '@/scoring/analytics'

// ─── Progreso por canción (B14) ───────────────────────────────────────────────
// Local por ahora; el historial completo, la racha y la meta semanal llegan en D7.

export interface SongScore {
  score: number
  precision: number | null
  stars: Stars
  playedAt: number // Date.now()
}

/** Una partida terminada. `playedAt` la identifica (guardar dos veces no duplica). */
export interface PlayRecord {
  score: number
  precision: number | null
  playedAt: number
  sections: SectionPrecision[]
}

export interface SongProgress {
  songId: string
  /** Mejor puntuación. */
  best: SongScore
  /** Última partida (Resultados la compara con la siguiente). */
  last: PlayRecord | null
  plays: number
}

/** Agrega una partida al progreso de la canción (puro; mismo `playedAt` = sin cambios). */
export function applyPlay(
  prev: SongProgress | undefined,
  songId: string,
  play: PlayRecord,
): SongProgress {
  if (prev?.last?.playedAt === play.playedAt) return prev
  const best: SongScore =
    prev && prev.best.score >= play.score
      ? prev.best
      : {
          score: play.score,
          precision: play.precision,
          stars: starsFor(play.precision),
          playedAt: play.playedAt,
        }
  return { songId, best, last: play, plays: (prev?.plays ?? 0) + 1 }
}

interface V1State {
  bestScores?: Record<string, SongScore & { songId: string }>
}

/** Progreso guardado por una versión anterior → versión actual. */
export function migrateProgress(
  persisted: unknown,
  version: number,
): { songs: Record<string, SongProgress> } {
  if (version === 1) {
    const songs: Record<string, SongProgress> = {}
    for (const [songId, s] of Object.entries((persisted as V1State)?.bestScores ?? {})) {
      songs[songId] = {
        songId,
        best: { score: s.score, precision: s.precision, stars: s.stars, playedAt: s.playedAt },
        last: null,
        plays: 1,
      }
    }
    return { songs }
  }
  if (version >= 2) return persisted as { songs: Record<string, SongProgress> }
  // v0: precisión de V1 (great/good), no comparable
  return { songs: {} }
}

interface ProgressStore {
  songs: Record<string, SongProgress>
  recordPlay(songId: string, play: PlayRecord): void
  clearAll(): void
}

export const useProgressStore = create<ProgressStore>()(
  persist(
    set => ({
      songs: {},

      recordPlay(songId, play) {
        set(state => {
          const prev = state.songs[songId]
          const next = applyPlay(prev, songId, play)
          return next === prev ? state : { songs: { ...state.songs, [songId]: next } }
        })
      },

      clearAll() {
        set({ songs: {} })
      },
    }),
    {
      name: 'drumhero-progress',
      // v2: mejor + última partida por canción (B14)
      version: 2,
      partialize: state => ({ songs: state.songs }),
      migrate: (persisted, version) =>
        migrateProgress(persisted, version) as unknown as ProgressStore,
    },
  ),
)

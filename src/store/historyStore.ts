import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '@/api/supabase'
import { createPlaysCloud } from '@/api/playsCloud'
import type { RemotePlays } from '@/api/playsCloud'
import { MAX_LOCAL_PLAYS } from '@/progress/history'
import type { PlayEntry } from '@/progress/history'

// ─── Historial de partidas (PLAN_V2 D7) ───────────────────────────────────────
// Siempre se guarda en el navegador; con sesión en la nube también en `plays`.
// Lo que no se pudo subir queda en `pending` y se reintenta en la próxima sync.

export interface HistoryState {
  /** Partidas, las más nuevas primero. */
  plays: PlayEntry[]
  /** Ids por subir a la nube. */
  pending: string[]
  /** Última partida agregada en esta pestaña (Resultados avisa sus insignias). */
  lastAdded: string | null
  addPlay(play: PlayEntry): void
  /** Sube lo pendiente y trae el historial de la cuenta (al entrar o cambiar de usuario). */
  sync(): Promise<void>
  clearAll(): void
}

export interface HistoryDeps {
  remote: RemotePlays | null
}

const newestFirst = (a: PlayEntry, b: PlayEntry) => b.playedAt - a.playedAt

/** Une el historial de la cuenta con lo pendiente de este navegador (puro). */
export function mergePlays(
  remote: readonly PlayEntry[],
  local: readonly PlayEntry[],
  pending: readonly string[],
): PlayEntry[] {
  const waiting = new Set(pending)
  const byId = new Map(remote.map(p => [p.id, p]))
  // Lo ya sincronizado que no está en la cuenta es de otra cuenta: sale de aquí
  for (const p of local) if (waiting.has(p.id) && !byId.has(p.id)) byId.set(p.id, p)
  return [...byId.values()].sort(newestFirst).slice(0, MAX_LOCAL_PLAYS)
}

export function createHistoryStore({ remote }: HistoryDeps) {
  return create<HistoryState>()(
    persist(
      (set, get) => {
        /** Sube lo pendiente; sin red queda para la próxima. */
        async function flush(): Promise<boolean> {
          if (!remote) return false
          const { plays, pending } = get()
          if (pending.length === 0) return true
          const ids = new Set(pending)
          const batch = plays.filter(p => ids.has(p.id))
          try {
            await remote.insertPlays(batch)
          } catch {
            return false
          }
          const sent = new Set(batch.map(p => p.id))
          // Lo que se agregó mientras tanto sigue pendiente
          set(state => ({ pending: state.pending.filter(id => !sent.has(id)) }))
          return true
        }

        return {
          plays: [],
          pending: [],
          lastAdded: null,

          addPlay(play) {
            if (get().plays.some(p => p.id === play.id)) return
            set(state => ({
              plays: [play, ...state.plays].sort(newestFirst).slice(0, MAX_LOCAL_PLAYS),
              pending: remote ? [...state.pending, play.id] : state.pending,
              lastAdded: play.id,
            }))
            void flush()
          },

          async sync() {
            if (!remote) return
            await flush()
            let list: PlayEntry[]
            try {
              list = await remote.listPlays(MAX_LOCAL_PLAYS)
            } catch {
              return // sin red: sigue lo local
            }
            set(state => ({ plays: mergePlays(list, state.plays, state.pending) }))
          },

          clearAll() {
            set({ plays: [], pending: [], lastAdded: null })
          },
        }
      },
      {
        name: 'drumhero-history',
        version: 1,
        partialize: state => ({ plays: state.plays, pending: state.pending }),
      },
    ),
  )
}

const sb = supabase()

export const useHistoryStore = createHistoryStore({ remote: sb ? createPlaysCloud(sb) : null })

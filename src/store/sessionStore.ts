import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LastSession, SongRef } from '@/game/lastSession'
import { sameSong } from '@/game/lastSession'

interface SessionStore {
  last: LastSession | null
  save(session: LastSession): void
  /** Olvida la sesión si es de esa canción (p. ej. se borró de la biblioteca). */
  forget(song: SongRef): void
  clear(): void
}

export const useSessionStore = create<SessionStore>()(
  persist(
    set => ({
      last: null,
      save: session => set({ last: session }),
      forget: song => set(s => (s.last && sameSong(s.last.song, song) ? { last: null } : s)),
      clear: () => set({ last: null }),
    }),
    { name: 'drumhero-session', version: 1, partialize: s => ({ last: s.last }) },
  ),
)

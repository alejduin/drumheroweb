import { useEffect, useState } from 'react'
import type { SongBundle } from '@/game/GameSession'
import { useLibraryStore } from '@/store/libraryStore'

export type BundleState =
  | { status: 'loading' }
  | { status: 'ready'; bundle: SongBundle }
  | { status: 'error'; message: string }

/** Carga una canción de la biblioteca (IndexedDB, o la nube la primera vez). */
export function useLibraryBundle(songId: string): BundleState {
  const [state, setState] = useState<{ id: string; value: BundleState } | null>(null)

  useEffect(() => {
    let cancelled = false
    useLibraryStore
      .getState()
      .bundle(songId)
      .then(
        bundle => !cancelled && setState({ id: songId, value: { status: 'ready', bundle } }),
        (e: unknown) =>
          !cancelled &&
          setState({
            id: songId,
            value: { status: 'error', message: e instanceof Error ? e.message : String(e) },
          }),
      )
    return () => {
      cancelled = true
    }
  }, [songId])

  // Mientras llega la canción pedida se muestra "cargando" (no la anterior)
  return state?.id === songId ? state.value : { status: 'loading' }
}

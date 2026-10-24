import { useEffect, useState } from 'react'
import { GameSession } from '@/game/GameSession'
import type { SessionOptions, SongBundle } from '@/game/GameSession'
import { midiManager } from '@/midi/MidiManager'

export type SessionState =
  | { status: 'loading' }
  | { status: 'ready'; session: GameSession }
  | { status: 'error'; message: string }

/**
 * Abre una GameSession para la canción y la cierra al desmontar o al cambiar de
 * canción. Las opciones se leen al abrir; los cambios en vivo (mezcla, dinámica)
 * van por los métodos de la sesión.
 */
export function useGameSession(
  bundle: SongBundle,
  readOptions: () => SessionOptions,
): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    let opened: GameSession | null = null
    setState({ status: 'loading' })
    GameSession.open(bundle, readOptions(), {
      subscribeHits: callback => midiManager.onHit(callback),
    }).then(
      session => {
        if (cancelled) {
          session.dispose()
          return
        }
        opened = session
        setState({ status: 'ready', session })
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    )
    return () => {
      cancelled = true
      opened?.dispose()
    }
    // readOptions se lee solo al abrir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle])

  return state
}

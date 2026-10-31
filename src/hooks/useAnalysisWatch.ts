import { useEffect, useState } from 'react'
import { useLibraryStore } from '@/store/libraryStore'

/** Cada cuánto se vuelve a mirar si el worker sigue vivo (late cada 30 s). */
export const WORKER_RECHECK_MS = 30_000
const TICK_MS = 1000

/**
 * Mientras `active` (hay un análisis en curso): devuelve la hora actual, que
 * cambia cada segundo para mostrar el tiempo transcurrido, y vuelve a comprobar
 * el worker cada WORKER_RECHECK_MS. Solo es para la pantalla de progreso,
 * no es el reloj del juego.
 */
export function useAnalysisWatch(active: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    const checkWorker = useLibraryStore.getState().checkWorker
    void checkWorker()
    const tick = setInterval(() => setNowMs(Date.now()), TICK_MS)
    const recheck = setInterval(() => void checkWorker(), WORKER_RECHECK_MS)
    return () => {
      clearInterval(tick)
      clearInterval(recheck)
    }
  }, [active])

  return nowMs
}

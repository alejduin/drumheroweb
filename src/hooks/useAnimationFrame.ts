import { useEffect, useRef } from 'react'

/**
 * Llama `callback` en cada requestAnimationFrame mientras `active`. Para pintar
 * (tiempo, cursor, barra de progreso) escribiendo en refs, sin re-render por frame.
 */
export function useAnimationFrame(callback: (nowMs: number) => void, active = true): void {
  const latest = useRef(callback)

  useEffect(() => {
    latest.current = callback
  }, [callback])

  useEffect(() => {
    if (!active) return
    let frameId = requestAnimationFrame(function frame(nowMs) {
      frameId = requestAnimationFrame(frame)
      latest.current(nowMs)
    })
    return () => cancelAnimationFrame(frameId)
  }, [active])
}

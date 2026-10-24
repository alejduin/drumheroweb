import { useEffect, useRef } from 'react'
import { gameEngine } from '@/engine/legacy/GameEngineV1'
import { flattenNotes } from '@/engine/SongParser'
import { createEffect, drawEffects, pruneEffects } from '@/renderer/EffectsRenderer'
import { drawHUD } from '@/renderer/HUDRenderer'
import { drawNotes } from '@/renderer/NoteRenderer'
import { useGameStore } from '@/store/legacy/gameStoreV1'
import type { ActiveEffect } from '@/renderer/EffectsRenderer'
import type { NoteEvent, SongData } from '@/types'

interface GameCanvasProps {
  song: SongData | null
  scrollSpeed?: number
}

/**
 * GameCanvas — componente React que gestiona el <canvas> del juego.
 *
 * Responsabilidades:
 * - Montar el canvas y obtener el contexto 2D
 * - Escuchar redimensionamientos con ResizeObserver
 * - Suscribirse a gameEngine.onFrame y gameEngine.onHitResult
 * - Llamar a los renderers en cada frame
 *
 * El HUD se lee directamente desde useGameStore.getState() dentro del RAF loop,
 * evitando re-renders de React en cada golpe durante el juego.
 *
 * NO contiene lógica de juego. Todo el estado del juego vive en GameEngine.
 */
export function GameCanvas({ song, scrollSpeed = 1 }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const notesRef = useRef<NoteEvent[]>([])
  const effectsRef = useRef<ActiveEffect[]>([])
  const scrollSpeedRef = useRef(scrollSpeed)

  useEffect(() => {
    scrollSpeedRef.current = scrollSpeed
  }, [scrollSpeed])

  // Actualizar notas cuando cambia la canción
  useEffect(() => {
    notesRef.current = song ? flattenNotes(song) : []
  }, [song])

  // Suscripción a efectos de hit
  useEffect(() => {
    return gameEngine.onHitResult(result => {
      if (result.accuracy === 'miss') return
      effectsRef.current = createEffect(
        effectsRef.current,
        result.noteEvent.instrument,
        result.accuracy,
      )
    })
  }, [])

  // Loop de render principal
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    return gameEngine.onFrame(gameTimeMs => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const { width, height } = canvas

      ctx.clearRect(0, 0, width, height)

      // 1. Notas scrollando
      drawNotes(ctx, gameTimeMs, notesRef.current, width, height, {
        scrollSpeed: scrollSpeedRef.current,
      })

      // 2. Efectos de hit
      effectsRef.current = pruneEffects(effectsRef.current, performance.now())
      drawEffects(ctx, effectsRef.current, width, height)

      // 3. HUD — leído imperativamente del store, sin re-render de React
      const { score, combo, multiplier, lastAccuracy, songDurationMs } = useGameStore.getState()
      const songProgressRatio = songDurationMs > 0 ? Math.min(1, gameTimeMs / songDurationMs) : 0

      drawHUD(ctx, { score, combo, multiplier, lastAccuracy, songProgressRatio }, width)
    })
  }, [])

  // ResizeObserver: mantener dimensiones del canvas en sync con su tamaño CSS
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        canvas.width = Math.round(width)
        canvas.height = Math.round(height)
      }
    })

    observer.observe(canvas)

    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.round(rect.width)
    canvas.height = Math.round(rect.height)

    return () => observer.disconnect()
  }, [])

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
}

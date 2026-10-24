import { useEffect, useMemo, useRef } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { THEME_COLORS } from '@/constants/theme'
import type { WaveformPeaks } from '@/types'
import type { SongClock } from '@/audio/AudioClock'
import { formatClock } from '@/game/format'
import { downsamplePeaks, xToTime } from '@/game/waveform'

// Barras como la maqueta: 5 px de ancho y 2 px de separación, de 4 a 60 px de alto
const BAR_WIDTH = 5
const BAR_GAP = 2
const MIN_BAR = 4
const KEY_STEP_S = 5

interface WaveformProps {
  peaks: WaveformPeaks
  clock: SongClock
  durationS: number
  onSeek: (songTime: number) => void
}

/**
 * Forma de onda del transporte (canvas) con el cursor del reloj maestro. Lo tocado
 * se pinta más claro. Clic = seek; teclado ←/→ = ±5 s. El loop A–B llega en la Fase D.
 */
export function Waveform({ peaks, clock, durationS, onSeek }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sliderRef = useRef<HTMLDivElement>(null)
  const source = useMemo(() => peaks.peaks, [peaks])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    let width = 0
    let height = 0
    let bars: number[] = []
    let lastX = -1
    let lastLabel = ''
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      width = rect.width
      height = rect.height
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const raw = downsamplePeaks(source, Math.floor((width + BAR_GAP) / (BAR_WIDTH + BAR_GAP)))
      const max = Math.max(...raw, 1e-6)
      bars = raw.map(p => p / max) // normalizado: una pista floja también se ve
      lastX = -1
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    let frameId = requestAnimationFrame(function frame() {
      frameId = requestAnimationFrame(frame)
      const now = Math.min(clock.now(), durationS)
      const cursorX = durationS > 0 ? (now / durationS) * width : 0
      const label = formatClock(now)
      if (label !== lastLabel && sliderRef.current) {
        sliderRef.current.setAttribute('aria-valuenow', String(Math.round(now)))
        sliderRef.current.setAttribute('aria-valuetext', label)
        lastLabel = label
      }
      if (Math.abs(cursorX - lastX) < 0.25) return // nada que repintar
      lastX = cursorX

      ctx.clearRect(0, 0, width, height)
      const step = bars.length > 0 ? (width + BAR_GAP) / bars.length : 0
      const barWidth = Math.max(step - BAR_GAP, 1)
      const usable = height - 8
      bars.forEach((p, i) => {
        const x = i * step
        const h = MIN_BAR + p * (usable - MIN_BAR)
        ctx.fillStyle =
          x + barWidth / 2 <= cursorX ? THEME_COLORS.faint : THEME_COLORS['border-strong']
        ctx.beginPath()
        ctx.roundRect(x, (height - h) / 2, barWidth, h, 2)
        ctx.fill()
      })
      ctx.fillStyle = THEME_COLORS.fg
      ctx.fillRect(Math.min(Math.max(cursorX - 1, 0), width - 2), 0, 2, height)
    })

    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
    }
  }, [source, clock, durationS])

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault() // sin foco (ni anillo) al hacer clic; Espacio sigue siendo play/pausa
    const rect = e.currentTarget.getBoundingClientRect()
    onSeek(xToTime(e.clientX - rect.left, rect.width, durationS))
  }

  function onKeyDown(e: KeyboardEvent) {
    const delta = e.key === 'ArrowRight' ? KEY_STEP_S : e.key === 'ArrowLeft' ? -KEY_STEP_S : 0
    if (e.key === 'Home') onSeek(0)
    else if (delta !== 0) onSeek(clock.now() + delta)
    else return
    e.preventDefault()
  }

  return (
    <div
      ref={sliderRef}
      role="slider"
      tabIndex={0}
      aria-label="Posición en la canción"
      aria-valuemin={0}
      aria-valuemax={Math.round(durationS)}
      aria-valuenow={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="relative h-16 shrink-0 cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  )
}

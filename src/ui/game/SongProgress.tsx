import { useCallback, useRef } from 'react'
import type { SongClock } from '@/audio/AudioClock'
import { formatClock } from '@/game/format'
import { useAnimationFrame } from '@/hooks/useAnimationFrame'

interface SongProgressProps {
  clock: SongClock
  durationS: number
}

/** Barra de progreso + "1:24 / 3:23". Se pinta por frame escribiendo en refs. */
export function SongProgress({ clock, durationS }: SongProgressProps) {
  const barRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const last = useRef({ pct: -1, text: '' })

  const paint = useCallback(() => {
    const now = Math.min(clock.now(), durationS)
    const pct = durationS > 0 ? (now / durationS) * 100 : 0
    const text = `${formatClock(now)} / ${formatClock(durationS)}`
    if (barRef.current && Math.abs(pct - last.current.pct) > 0.01) {
      barRef.current.style.width = `${pct}%`
      last.current.pct = pct
    }
    if (timeRef.current && text !== last.current.text) {
      timeRef.current.textContent = text
      last.current.text = text
    }
  }, [clock, durationS])
  useAnimationFrame(paint)

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5 px-4">
      <div className="h-1 flex-1 rounded-[2px] bg-border" aria-hidden="true">
        <div ref={barRef} className="h-full w-0 rounded-[2px] bg-accent" />
      </div>
      <span ref={timeRef} className="font-mono text-xs text-muted tabular-nums">
        {`0:00 / ${formatClock(durationS)}`}
      </span>
    </div>
  )
}

import type { HitWindows } from '@/constants/scoring'
import { meterPosition, meterTone, timingText } from '@/game/timingMeter'
import type { MeterTone } from '@/game/timingMeter'
import { selectTimingTrend, useGameStore } from '@/store/gameStore'
import { cn } from '@/ui/primitives'

const DOT_TONES: Record<MeterTone, string> = {
  perfect: 'bg-perfect',
  close: 'bg-close',
  miss: 'bg-miss',
}

/** ‹ Temprano ——●—— Tarde ›  "vas +14 ms tarde en promedio" (sobre el papel). */
export function TimingMeter({ windows }: { windows: HitWindows }) {
  const trend = useGameStore(selectTimingTrend)
  const position = meterPosition(trend, windows.closeMs)
  const text = timingText(trend)
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-xs font-semibold text-paper-muted">‹ Temprano</span>
      <div
        role="meter"
        aria-label="Tendencia de timing"
        aria-valuemin={-windows.closeMs}
        aria-valuemax={windows.closeMs}
        aria-valuenow={Math.round(trend ?? 0)}
        aria-valuetext={text}
        className="relative h-2.5 w-60 rounded-[5px] bg-paper-chip"
      >
        <div className="absolute -top-[3px] left-1/2 h-4 w-0.5 -translate-x-1/2 bg-on-accent" />
        <div
          className={cn(
            'absolute -top-0.5 size-3.5 -translate-x-1/2 rounded-full border-2 border-paper-active transition-[left] duration-150',
            DOT_TONES[meterTone(trend, windows)],
          )}
          style={{ left: `${position * 100}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-paper-muted">Tarde ›</span>
      <span className="text-xs text-faint">{text}</span>
    </div>
  )
}

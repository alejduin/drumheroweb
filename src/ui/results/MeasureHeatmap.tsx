import { precisionTone } from '@/constants/scoring'
import { formatPercent } from '@/game/format'
import type { MeasureBar } from '@/scoring/analytics'
import { cn } from '@/ui/primitives/cn'

const TONE_BG = { perfect: 'bg-perfect', close: 'bg-close', miss: 'bg-miss' } as const

// Altura mínima para que un compás con 0 % siga viéndose
const MIN_HEIGHT_PCT = 6

/** Una barra por compás: altura y color por precisión (PLAN_V2 D18). */
export function MeasureHeatmap({ bars }: { bars: readonly MeasureBar[] }) {
  return (
    <div className="flex h-[90px] items-end gap-[3px]">
      {bars.map(({ measure, precision }) => (
        <div
          key={measure}
          title={`Compás ${measure}: ${formatPercent(precision)}`}
          className={cn(
            'min-w-px flex-1 rounded-[3px]',
            precision === null ? 'bg-track' : TONE_BG[precisionTone(precision)],
          )}
          style={{
            height: `${precision === null ? MIN_HEIGHT_PCT : Math.max(precision * 100, MIN_HEIGHT_PCT)}%`,
          }}
        />
      ))}
    </div>
  )
}

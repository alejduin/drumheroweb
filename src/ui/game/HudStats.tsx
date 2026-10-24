import { formatPercent, formatScore } from '@/game/format'
import {
  selectCombo,
  selectMultiplier,
  selectPrecision,
  selectScore,
  useGameStore,
} from '@/store/gameStore'
import { StatTile, cn } from '@/ui/primitives'

/** PUNTOS / COMBO ×n / PRECISIÓN: cada valor se re-renderiza solo cuando cambia (por golpe). */
export function HudStats() {
  const score = useGameStore(selectScore)
  const combo = useGameStore(selectCombo)
  const multiplier = useGameStore(selectMultiplier)
  const precision = useGameStore(selectPrecision)
  return (
    <div className="flex items-center gap-7">
      <StatTile size="compact" label="Puntos" value={formatScore(score)} />
      <StatTile
        size="compact"
        label="Combo"
        value={
          <>
            {combo}{' '}
            <span className={cn('text-sm', multiplier > 1 ? 'text-perfect-fg' : 'text-faint')}>
              ×{multiplier}
            </span>
          </>
        }
      />
      <StatTile size="compact" label="Precisión" value={formatPercent(precision)} />
    </div>
  )
}

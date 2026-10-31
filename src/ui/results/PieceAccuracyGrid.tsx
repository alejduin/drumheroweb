import { precisionTone } from '@/constants/scoring'
import { formatPercent } from '@/game/format'
import type { ScoreResults } from '@/scoring/ScoreManager'
import { PIECE_GROUPS, PIECE_GROUP_LABELS } from '@/scoring/pieceGroups'
import { Panel } from '@/ui/primitives'
import { cn } from '@/ui/primitives/cn'

const TONE_TEXT = { perfect: 'text-perfect-fg', close: 'text-close-fg', miss: 'text-miss' } as const

/** Precisión por grupo de piezas: Bombo, Caja, Hi-hat, Toms, Platillos. */
export function PieceAccuracyGrid({ byGroup }: { byGroup: ScoreResults['byGroup'] }) {
  return (
    <Panel title="Por pieza" className="flex-1">
      <dl className="grid grid-cols-5 gap-2 text-xs text-muted">
        {PIECE_GROUPS.map(group => {
          const { precision } = byGroup[group]
          return (
            <div key={group} className="flex flex-col gap-1">
              <dt>{PIECE_GROUP_LABELS[group]}</dt>
              <dd
                className={cn(
                  'font-mono text-lg',
                  precision === null ? 'text-faint' : TONE_TEXT[precisionTone(precision)],
                )}
              >
                {formatPercent(precision)}
              </dd>
            </div>
          )
        })}
      </dl>
    </Panel>
  )
}

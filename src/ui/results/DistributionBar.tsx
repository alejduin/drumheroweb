import type { Distribution } from '@/scoring/analytics'
import { Legend, Panel } from '@/ui/primitives'

/** Barra apilada Perfecto / Cerca / Fallo con su leyenda (pad incorrecto aparte). */
export function DistributionBar({
  distribution,
  wrongPad,
}: {
  distribution: Distribution | null
  wrongPad: number
}) {
  const d = distribution ?? { perfect: 0, close: 0, miss: 0 }
  return (
    <Panel
      title="Distribución de golpes"
      aside={wrongPad > 0 ? `${wrongPad} en pad incorrecto (no cuentan)` : undefined}
      className="flex-1"
    >
      <div
        className="flex h-3.5 overflow-hidden rounded-[7px] bg-track"
        role="img"
        aria-label={`Perfecto ${d.perfect}%, Cerca ${d.close}%, Fallo ${d.miss}%`}
      >
        <div className="bg-perfect" style={{ width: `${d.perfect}%` }} />
        <div className="bg-close" style={{ width: `${d.close}%` }} />
        <div className="bg-miss" style={{ width: `${d.miss}%` }} />
      </div>
      <Legend
        className="text-[13px]"
        items={[
          { label: `Perfecto ${d.perfect}%`, color: 'perfect' },
          { label: `Cerca ${d.close}%`, color: 'close' },
          { label: `Fallo ${d.miss}%`, color: 'miss' },
        ]}
      />
    </Panel>
  )
}

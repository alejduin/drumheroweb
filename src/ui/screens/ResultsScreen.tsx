import { useEffect } from 'react'
import { starsFor } from '@/constants/scoring'
import type { ChartV2 } from '@/types'
import { formatPercent, formatScore, formatSignedMs } from '@/game/format'
import type { ScoreResults } from '@/scoring/ScoreManager'
import { useProgressStore } from '@/store/progressStore'
import { Button, Legend, StatTile, Stars } from '@/ui/primitives'

interface ResultsScreenProps {
  chart: ChartV2
  results: ScoreResults
  onRetry: () => void
  onMenu: () => void
}

/** Resultados mínimos de la partida; B14 los completa según design/Results.dc.html. */
export function ResultsScreen({ chart, results, onRetry, onMenu }: ResultsScreenProps) {
  const saveSongScore = useProgressStore(s => s.saveSongScore)
  const { score, precision, bestCombo, meanDeltaMs, counts } = results

  useEffect(() => {
    saveSongScore(chart.id, score, precision)
  }, [chart.id, score, precision, saveSongScore])

  return (
    <main className="flex h-full flex-col items-center justify-center gap-8 bg-bg px-6 font-sans text-fg">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="text-[11px] tracking-[0.08em] text-muted uppercase">Resultado</span>
        <h1 className="text-3xl font-extrabold">
          {chart.title} — {chart.artist}
        </h1>
        <Stars value={starsFor(precision)} />
      </div>

      <div className="grid w-full max-w-4xl grid-cols-4 gap-4">
        <StatTile size="lg" label="Puntos" value={formatScore(score)} />
        <StatTile size="lg" label="Precisión" value={formatPercent(precision)} />
        <StatTile size="lg" label="Mejor combo" value={bestCombo} />
        <StatTile
          size="lg"
          label="Timing"
          value={meanDeltaMs === null ? '—' : formatSignedMs(meanDeltaMs)}
          hint={
            meanDeltaMs === null
              ? undefined
              : meanDeltaMs > 0
                ? 'tarde en promedio'
                : 'temprano en promedio'
          }
        />
      </div>

      <Legend
        items={[
          { label: `Perfecto ${counts.perfect}`, color: 'perfect' },
          { label: `Cerca ${counts.close}`, color: 'close' },
          { label: `Fallo ${counts.miss}`, color: 'miss' },
          { label: `Pad incorrecto ${counts.wrongPad}`, color: 'wrong' },
        ]}
      />

      <div className="flex gap-4">
        <Button variant="primary" onClick={onRetry}>
          Reintentar
        </Button>
        <Button onClick={onMenu}>Elegir otra canción</Button>
      </div>
    </main>
  )
}

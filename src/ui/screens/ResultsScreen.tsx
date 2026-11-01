import { useEffect, useMemo, useState } from 'react'
import { LEVEL_POINTS, starsFor } from '@/constants/scoring'
import type { ChartV2 } from '@/types'
import { formatPercent, formatScore, formatSignedMs } from '@/game/format'
import { PRACTICE_TEMPO } from '@/game/sections'
import { LEVEL_LABELS } from '@/game/songMeta'
import {
  buildHeadline,
  distributionOf,
  findWeakestMeasures,
  measureBars,
  measureSpans,
  timingTendency,
} from '@/scoring/analytics'
import type { SectionPrecision } from '@/scoring/analytics'
import { PIECE_GROUP_LABELS } from '@/scoring/pieceGroups'
import { sectionForMeasure } from '@/scoring/ScoreManager'
import type { ScoreResults } from '@/scoring/ScoreManager'
import { useProgressStore } from '@/store/progressStore'
import { useSettingsStore } from '@/store/settingsStore'
import { SectionRuler } from '@/ui/game/SectionRuler'
import { Button, Panel, StatTile, Stars } from '@/ui/primitives'
import { DistributionBar } from '@/ui/results/DistributionBar'
import { MeasureHeatmap } from '@/ui/results/MeasureHeatmap'
import { PieceAccuracyGrid } from '@/ui/results/PieceAccuracyGrid'

interface ResultsScreenProps {
  chart: ChartV2
  results: ScoreResults
  /** Momento en que terminó la partida; identifica la partida en el progreso. */
  playedAt: number
  onRetry: () => void
  onMenu: () => void
}

/** Resultados de la partida (design/Results.dc.html, PLAN_V2 §4.5). */
export function ResultsScreen({ chart, results, playedAt, onRetry, onMenu }: ResultsScreenProps) {
  const level = useSettingsStore(s => s.level)
  // El tempo con que se jugó (el último elegido)
  const tempo = useSettingsStore(s => s.tempo)
  const recordPlay = useProgressStore(s => s.recordPlay)
  // Progreso de antes de esta partida (se lee una vez, antes de guardarla)
  const [before] = useState(() => useProgressStore.getState().songs[chart.id] ?? null)
  const { score, precision, bestCombo, bestComboRun, meanDeltaMs, counts, bySection } = results

  const sections = useMemo<SectionPrecision[]>(
    () =>
      bySection.map(s => ({ name: s.name, startMeasure: s.startMeasure, precision: s.precision })),
    [bySection],
  )

  useEffect(() => {
    recordPlay(chart.id, { score, precision, playedAt, sections })
  }, [chart.id, score, precision, playedAt, sections, recordPlay])

  const previous = before?.last ?? null
  const headline = buildHeadline({ precision, sections }, previous)
  const isRecord = before !== null && score > before.best.score
  const timing = timingTendency(meanDeltaMs)
  const comboSection = bestComboRun ? sectionForMeasure(bySection, bestComboRun.startMeasure) : null
  const weak = findWeakestMeasures(results.byMeasure)
  const totalMeasures = chart.grid.downbeats.length
  const points = LEVEL_POINTS[level]

  const scoreHint =
    before === null
      ? 'primera partida'
      : isRecord
        ? 'récord personal'
        : `récord ${formatScore(before.best.score)}`

  return (
    <main className="flex h-full flex-col overflow-y-auto bg-bg font-sans text-fg">
      <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-6 p-10">
        <header className="flex items-end justify-between gap-6">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs tracking-[0.08em] text-muted uppercase">
              {chart.title} · {LEVEL_LABELS[level]} · Tempo {Math.round(tempo * 100)}%
            </span>
            <h1 className="text-[34px] font-extrabold tracking-[-0.02em]">{headline}</h1>
          </div>
          <Stars value={starsFor(precision)} />
        </header>

        <div className="grid grid-cols-4 gap-4">
          <StatTile
            size="lg"
            label="Puntos"
            value={formatScore(score)}
            hint={scoreHint}
            hintTone={isRecord ? 'perfect' : 'default'}
          />
          <div
            title={`Precisión = (Perfecto + Cerca) / notas evaluadas. Puntos: Perfecto ${points.perfect}, Cerca ${points.close}, Fallo 0, × combo.`}
          >
            <StatTile
              size="lg"
              label="Precisión"
              value={formatPercent(precision)}
              hint={previous ? `anterior ${formatPercent(previous.precision)}` : undefined}
              className="h-full"
            />
          </div>
          <StatTile
            size="lg"
            label="Mejor combo"
            value={bestCombo}
            hint={comboSection ? `en ${comboSection.name}` : undefined}
          />
          <StatTile
            size="lg"
            label="Timing"
            value={meanDeltaMs === null ? '—' : formatSignedMs(meanDeltaMs)}
            hint={timing?.text}
            hintTone={timing?.tone}
          />
        </div>

        <div className="flex gap-4">
          <DistributionBar distribution={distributionOf(counts)} wrongPad={counts.wrongPad} />
          <PieceAccuracyGrid byGroup={results.byGroup} />
        </div>

        <Panel
          title="Precisión por compás"
          aside="cada barra es un compás · verde ≥ 85 %, ámbar ≥ 72 %, rojo por debajo"
          className="flex-1"
        >
          <MeasureHeatmap bars={measureBars(results.byMeasure, totalMeasures)} />
          <SectionRuler spans={measureSpans(bySection, totalMeasures)} />
          <div className="flex-1" />
          <div className="flex flex-wrap items-center gap-3">
            {weak && (
              <Button
                variant="primary"
                size="lg"
                disabled
                title="La práctica por compases llega en la Fase D"
              >
                {weak.startMeasure === weak.endMeasure
                  ? `Practicar el compás ${weak.startMeasure}`
                  : `Practicar compases ${weak.startMeasure}–${weak.endMeasure}`}
                {weak.group && ` (${PIECE_GROUP_LABELS[weak.group].toLowerCase()})`} al{' '}
                {Math.round(PRACTICE_TEMPO * 100)}%
              </Button>
            )}
            <Button variant={weak ? 'secondary' : 'primary'} size="lg" onClick={onRetry}>
              Reintentar
            </Button>
            <Button size="lg" onClick={onMenu}>
              Elegir otra canción
            </Button>
            <div className="flex-1" />
            <span className="text-[13px] text-muted">
              Partida nº {(before?.plays ?? 0) + 1} de esta canción
            </span>
          </div>
        </Panel>
      </div>
    </main>
  )
}

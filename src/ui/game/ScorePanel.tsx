import { useMemo } from 'react'
import { LEVEL_WINDOWS } from '@/constants/scoring'
import { currentAccent } from '@/constants/theme'
import type { ChartGrid, ChartNote, Level, ScoreView } from '@/types'
import type { SongClock } from '@/audio/AudioClock'
import { ScoreCanvas } from '@/renderer/ScoreCanvas'
import type { ScoreSource } from '@/renderer/ScoreCanvas'
import { Legend, SegmentedControl } from '@/ui/primitives'
import { TimingMeter } from './TimingMeter'

const VIEWS = [
  { value: 'staff', label: 'Pentagrama' },
  { value: 'lanes', label: 'Carriles' },
] as const

interface ScorePanelProps {
  source: ScoreSource
  clock: SongClock
  notes: readonly ChartNote[]
  grid: ChartGrid
  view: ScoreView
  onViewChange: (view: ScoreView) => void
  level: Level
  scrollSpeed: number
}

/** Partitura sobre papel (300 px): canvas, vista, medidor de timing y leyenda del nivel. */
export function ScorePanel({
  source,
  clock,
  notes,
  grid,
  view,
  onViewChange,
  level,
  scrollSpeed,
}: ScorePanelProps) {
  const windows = LEVEL_WINDOWS[level]
  const accent = useMemo(() => currentAccent(), [])
  return (
    <section
      aria-label="Partitura"
      className="relative mx-6 mt-4 h-[300px] shrink-0 overflow-hidden rounded-xl bg-paper"
    >
      <ScoreCanvas
        source={source}
        clock={clock}
        notes={notes}
        grid={grid}
        view={view}
        accent={accent}
        scrollSpeed={scrollSpeed}
      />
      <SegmentedControl
        aria-label="Vista de la partitura"
        variant="paper"
        options={VIEWS}
        value={view}
        onChange={onViewChange}
        className="absolute top-3 right-4 z-10"
      />
      <div className="absolute right-6 bottom-3.5 left-6 flex items-center gap-6">
        <TimingMeter windows={windows} />
        <div className="flex-1" />
        <Legend
          variant="paper"
          className="gap-x-3.5"
          items={[
            { label: `Perfecto ±${windows.perfectMs} ms`, color: 'perfect' },
            { label: `Cerca ±${windows.closeMs} ms`, color: 'close' },
            { label: 'Fallo', color: 'miss' },
          ]}
        />
      </div>
    </section>
  )
}

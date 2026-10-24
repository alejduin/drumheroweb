import { useCallback, useEffect, useRef, useState } from 'react'
import { precisionTone } from '@/constants/scoring'
import type { ChartGrid, ChartSection } from '@/types'
import type { SongClock } from '@/audio/AudioClock'
import { measureAt } from '@/chart/grid'
import { formatPercent } from '@/game/format'
import { practiceSuggestion, sectionIndexAt } from '@/game/sections'
import { useAnimationFrame } from '@/hooks/useAnimationFrame'
import { selectSections, useGameStore } from '@/store/gameStore'
import { Button, Panel, cn } from '@/ui/primitives'

const TONE_TEXT = { perfect: 'text-perfect-fg', close: 'text-close-fg', miss: 'text-miss' } as const

interface SectionsPanelProps {
  sections: readonly ChartSection[]
  grid: ChartGrid
  clock: SongClock
  onSeekSection: (section: ChartSection) => void
  /** Si el video está oculto, el panel ofrece volver a mostrarlo. */
  onShowVideo?: () => void
}

/** Precisión por sección en vivo; la fila actual con borde de acento. */
export function SectionsPanel({
  sections,
  grid,
  clock,
  onSeekSection,
  onShowVideo,
}: SectionsPanelProps) {
  const stats = useGameStore(selectSections)
  const [current, setCurrent] = useState(-1)
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([])

  // La sección actual sale del reloj; solo hay re-render cuando cambia
  const track = useCallback(
    () => setCurrent(sectionIndexAt(sections, measureAt(grid, clock.now()))),
    [sections, grid, clock],
  )
  useAnimationFrame(track)

  useEffect(() => {
    rowRefs.current[current]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [current])

  const suggestion = practiceSuggestion(stats)
  return (
    <Panel
      title="Secciones"
      aside={
        onShowVideo ? (
          <button type="button" onClick={onShowVideo} className="cursor-pointer hover:text-fg">
            mostrar video (V) · precisión
          </button>
        ) : (
          'precisión'
        )
      }
      className="min-w-0 flex-1 gap-2.5"
    >
      <ol className="-mx-1 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-1 py-px">
        {sections.map((section, i) => {
          const precision = stats[i]?.precision ?? null
          const isCurrent = i === current
          return (
            <li key={`${section.startMeasure}-${section.name}`}>
              <button
                ref={el => {
                  rowRefs.current[i] = el
                }}
                type="button"
                title={`Ir a los compases ${section.startMeasure}–${section.endMeasure}`}
                aria-current={isCurrent ? 'step' : undefined}
                onClick={() => onSeekSection(section)}
                className={cn(
                  'flex h-9 w-full cursor-pointer items-center justify-between rounded-sm bg-surface-2 px-3 text-left text-[13px] transition hover:bg-track',
                  isCurrent && 'border border-accent bg-accent-soft font-semibold',
                  !isCurrent && precision === null && 'text-muted',
                )}
              >
                <span className="truncate">
                  {section.name}
                  {isCurrent && ' · ahora'}
                </span>
                <span
                  className={cn(
                    'font-mono',
                    precision !== null && TONE_TEXT[precisionTone(precision)],
                  )}
                >
                  {formatPercent(precision)}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <Button
        variant="primary"
        fullWidth
        disabled
        title="La práctica por compases llega en la Fase D"
      >
        {suggestion
          ? `Practicar compases ${suggestion.startMeasure}–${suggestion.endMeasure} al ${Math.round(suggestion.tempo * 100)}%`
          : 'Practicar una sección'}
      </Button>
    </Panel>
  )
}

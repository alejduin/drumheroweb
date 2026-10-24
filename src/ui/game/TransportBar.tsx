import { useCallback, useMemo, useRef } from 'react'
import type { ChartGrid, ChartSection, WaveformPeaks } from '@/types'
import type { SongClock } from '@/audio/AudioClock'
import { formatClockMs } from '@/game/format'
import { rulerLabel, sectionSpans } from '@/game/sections'
import { useAnimationFrame } from '@/hooks/useAnimationFrame'
import { Button, IconButton } from '@/ui/primitives'
import { SectionRuler } from './SectionRuler'
import { Waveform } from './Waveform'
import { PauseIcon, PlayIcon } from './icons'

const PHASE_D = 'Llega en la Fase D'

interface TransportBarProps {
  clock: SongClock
  durationS: number
  fileName: string | null
  playing: boolean
  peaks: WaveformPeaks
  sections: readonly ChartSection[]
  /** Secciones automáticas (el chart no trae): la regla muestra números de compás. */
  autoSections: boolean
  grid: ChartGrid
  onToggle: () => void
  onSeek: (songTime: number) => void
}

/** Transporte: play/pausa, reloj maestro con milisegundos, forma de onda y secciones. */
export function TransportBar({
  clock,
  durationS,
  fileName,
  playing,
  peaks,
  sections,
  autoSections,
  grid,
  onToggle,
  onSeek,
}: TransportBarProps) {
  const timeRef = useRef<HTMLSpanElement>(null)
  const total = formatClockMs(durationS)
  const paint = useCallback(() => {
    if (timeRef.current) {
      timeRef.current.textContent = `${formatClockMs(Math.min(clock.now(), durationS))} / ${total}`
    }
  }, [clock, durationS, total])
  useAnimationFrame(paint)

  const spans = useMemo(
    () => sectionSpans(sections, grid, durationS, s => rulerLabel(s, autoSections)),
    [sections, grid, durationS, autoSections],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-lg border border-border bg-surface px-[18px] py-3.5">
      <div className="flex items-center gap-3.5">
        <IconButton
          variant="round"
          aria-label={playing ? 'Pausar' : 'Reproducir'}
          onClick={onToggle}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </IconButton>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[13px] font-semibold">
            {fileName ?? 'pista silenciosa'} · reloj maestro
          </span>
          <span ref={timeRef} className="font-mono text-xs text-muted tabular-nums">
            {`${formatClockMs(0)} / ${total}`}
          </span>
        </div>
        <div className="flex-1" />
        <Button size="sm" disabled title={PHASE_D}>
          Loop A–B
        </Button>
        <Button size="sm" disabled title={PHASE_D}>
          Tempo 100%
        </Button>
        <Button size="sm" disabled title={PHASE_D}>
          Cuenta 1 compás
        </Button>
      </div>
      <Waveform peaks={peaks} clock={clock} durationS={durationS} onSeek={onSeek} />
      <SectionRuler spans={spans} />
    </div>
  )
}

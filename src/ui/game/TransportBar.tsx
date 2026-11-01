import { useCallback, useMemo, useRef } from 'react'
import type { ChartGrid, ChartSection, WaveformPeaks } from '@/types'
import type { SongClock } from '@/audio/AudioClock'
import { formatClockMs } from '@/game/format'
import { loopAt, loopFromSelection, loopRange } from '@/game/practice'
import type { PracticeLoop } from '@/game/practice'
import { rulerLabel, sectionSpans } from '@/game/sections'
import { useAnimationFrame } from '@/hooks/useAnimationFrame'
import { Button, Chip, IconButton } from '@/ui/primitives'
import { SectionRuler } from './SectionRuler'
import { Waveform } from './Waveform'
import { PauseIcon, PlayIcon, RestartIcon } from './icons'

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
  /** Loop A–B por compases (D3). */
  loop: PracticeLoop | null
  onLoopChange: (loop: PracticeLoop | null) => void
  tempo: number
  countIn: boolean
  onCountInChange: (on: boolean) => void
}

/**
 * Transporte: play/pausa, reloj maestro con milisegundos, forma de onda y secciones.
 * Loop A–B (arrastrar sobre la onda o el botón), tempo y cuenta de un compás.
 */
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
  loop,
  onLoopChange,
  tempo,
  countIn,
  onCountInChange,
}: TransportBarProps) {
  const timeRef = useRef<HTMLSpanElement>(null)
  const total = formatClockMs(durationS)
  const paint = useCallback(() => {
    if (timeRef.current) {
      timeRef.current.textContent = `${formatClockMs(Math.min(clock.now(), durationS))} / ${total}`
    }
  }, [clock, durationS, total])
  useAnimationFrame(paint)

  const loopSeconds = useMemo(
    () => (loop ? loopRange(grid, durationS, loop) : null),
    [loop, grid, durationS],
  )
  const selectLoop = useCallback(
    (fromS: number, toS: number) => onLoopChange(loopFromSelection(grid, fromS, toS)),
    [grid, onLoopChange],
  )

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
        <IconButton
          variant="ghost"
          aria-label="Volver al principio"
          title="Volver al principio de la canción (Inicio)"
          onClick={() => onSeek(0)}
        >
          <RestartIcon size={14} />
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
        <Button
          size="sm"
          variant={loop ? 'primary' : 'secondary'}
          aria-pressed={loop !== null}
          title={
            loop
              ? 'Quitar el loop'
              : 'Loop de 4 compases desde aquí; también puedes arrastrar sobre la onda'
          }
          onClick={() => onLoopChange(loop ? null : loopAt(grid, clock.now()))}
        >
          {loop
            ? `Loop ${loop.startMeasure === loop.endMeasure ? loop.startMeasure : `${loop.startMeasure}–${loop.endMeasure}`} ✕`
            : 'Loop A–B'}
        </Button>
        <Chip tone={tempo < 1 ? 'strong' : 'muted'}>Tempo {Math.round(tempo * 100)}%</Chip>
        <Button
          size="sm"
          variant={countIn ? 'primary' : 'secondary'}
          aria-pressed={countIn}
          title="Un compás de metrónomo antes de que suene la canción al empezar o reanudar"
          onClick={() => onCountInChange(!countIn)}
        >
          Cuenta 1 compás
        </Button>
      </div>
      <Waveform
        peaks={peaks}
        clock={clock}
        durationS={durationS}
        onSeek={onSeek}
        loop={loopSeconds}
        onSelect={selectLoop}
      />
      <SectionRuler spans={spans} />
    </div>
  )
}

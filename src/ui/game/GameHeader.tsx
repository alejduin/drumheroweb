import type { ChartV2, Difficulty } from '@/types'
import type { SongClock } from '@/audio/AudioClock'
import type { PracticeLayer } from '@/chart/layers'
import { songMeta } from '@/game/songMeta'
import { Button, IconButton } from '@/ui/primitives'
import { HudStats } from './HudStats'
import { MidiStatusPill } from './MidiStatusPill'
import { SongProgress } from './SongProgress'
import { PauseIcon, PlayIcon, RestartIcon } from './icons'

interface GameHeaderProps {
  chart: ChartV2
  difficulty: Difficulty
  /** Tempo de la partida (1 = normal). */
  tempo?: number
  /** Capa de práctica (D5). */
  layer?: PracticeLayer
  clock: SongClock
  playing: boolean
  onToggle: () => void
  /** Vuelve al principio de la canción. */
  onRestart: () => void
  /** Sale a la portada. */
  onExit: () => void
}

export function GameHeader({
  chart,
  difficulty,
  tempo = 1,
  layer = 'full',
  clock,
  playing,
  onToggle,
  onRestart,
  onExit,
}: GameHeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-6 border-b border-border bg-surface-header px-6">
      <Button size="sm" title="Volver a la portada (Esc)" onClick={onExit}>
        ← Inicio
      </Button>
      <div className="flex items-center gap-2">
        <IconButton
          aria-label="Volver al principio"
          title="Volver al principio de la canción (Inicio)"
          onClick={onRestart}
        >
          <RestartIcon />
        </IconButton>
        <IconButton aria-label={playing ? 'Pausar' : 'Reproducir'} onClick={onToggle}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </IconButton>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="truncate text-[17px] font-bold tracking-[-0.01em]">
          {chart.title} — {chart.artist}
        </div>
        <div className="truncate text-xs text-muted">
          {songMeta(chart, difficulty, tempo, layer)}
        </div>
      </div>
      <SongProgress clock={clock} durationS={chart.durationS} />
      <div className="flex items-center gap-7">
        <HudStats />
        <MidiStatusPill />
      </div>
    </header>
  )
}

import type { ChartV2, Difficulty } from '@/types'
import type { SongClock } from '@/audio/AudioClock'
import { songMeta } from '@/game/songMeta'
import { IconButton } from '@/ui/primitives'
import { HudStats } from './HudStats'
import { MidiStatusPill } from './MidiStatusPill'
import { SongProgress } from './SongProgress'
import { PauseIcon, PlayIcon } from './icons'

interface GameHeaderProps {
  chart: ChartV2
  difficulty: Difficulty
  /** Tempo de la partida (1 = normal). */
  tempo?: number
  clock: SongClock
  playing: boolean
  onToggle: () => void
}

export function GameHeader({
  chart,
  difficulty,
  tempo = 1,
  clock,
  playing,
  onToggle,
}: GameHeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-6 border-b border-border bg-surface-header px-6">
      <IconButton aria-label={playing ? 'Pausar' : 'Reproducir'} onClick={onToggle}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </IconButton>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="truncate text-[17px] font-bold tracking-[-0.01em]">
          {chart.title} — {chart.artist}
        </div>
        <div className="truncate text-xs text-muted">{songMeta(chart, difficulty, tempo)}</div>
      </div>
      <SongProgress clock={clock} durationS={chart.durationS} />
      <div className="flex items-center gap-7">
        <HudStats />
        <MidiStatusPill />
      </div>
    </header>
  )
}

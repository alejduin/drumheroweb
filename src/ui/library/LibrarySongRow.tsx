import type { TrackerState } from '@/library/jobTracker'
import { stageSummary } from '@/library/importView'
import { STATUS_LABELS } from '@/library/status'
import type { SongStatus } from '@/library/status'
import { formatClock } from '@/game/format'
import type { LibrarySong } from '@/storage/libraryDb'
import { Button, StatusPill } from '@/ui/primitives'
import type { StatusTone } from '@/ui/primitives'

const STATUS_TONES: Record<SongStatus, StatusTone> = {
  analyzing: 'neutral',
  ready: 'perfect',
  needs_review: 'close',
  failed: 'miss',
}

interface LibrarySongRowProps {
  song: LibrarySong
  tracker: TrackerState | null
  busy: boolean
  /** Hora actual (cambia cada segundo durante el análisis). */
  nowMs?: number
  workerOffline?: boolean
  onPlay: () => void
  onOpen: () => void
  onSyncVideo: () => void
  onRetry: () => void
  onRemove: () => void
}

/** Una canción importada en la Biblioteca: estado y acciones. */
export function LibrarySongRow({
  song,
  tracker,
  busy,
  nowMs,
  workerOffline = false,
  onPlay,
  onOpen,
  onSyncVideo,
  onRetry,
  onRemove,
}: LibrarySongRowProps) {
  const playable = song.status === 'ready' || song.status === 'needs_review'
  const detail =
    song.status === 'analyzing'
      ? stageSummary(tracker, { nowMs, workerOffline })
      : song.status === 'failed'
        ? (song.error?.message ?? 'El análisis falló')
        : [
            song.artist,
            formatClock(song.durationS),
            song.summary && `${Math.round(song.summary.bpm)} BPM`,
          ]
            .filter(Boolean)
            .join(' · ')

  return (
    <li className="flex items-center gap-4 rounded-md bg-surface-2 p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-bold">{song.title}</span>
        <span className={song.status === 'failed' ? 'text-xs text-miss' : 'text-xs text-muted'}>
          {detail}
        </span>
      </div>
      <StatusPill tone={STATUS_TONES[song.status]} className="py-1.5">
        {STATUS_LABELS[song.status]}
      </StatusPill>
      <div className="flex shrink-0 gap-2">
        {playable && (
          <Button size="sm" variant="primary" disabled={busy} onClick={onPlay}>
            {busy ? 'Cargando…' : 'Jugar'}
          </Button>
        )}
        {playable && song.youtubeUrl && (
          <Button size="sm" onClick={onSyncVideo}>
            Sincronizar video
          </Button>
        )}
        {song.status === 'analyzing' && (
          <Button size="sm" onClick={onOpen}>
            Ver progreso
          </Button>
        )}
        {song.status === 'failed' && (
          <Button size="sm" variant="primary" onClick={onRetry}>
            Reintentar
          </Button>
        )}
        <Button
          size="sm"
          aria-label={`${song.status === 'analyzing' ? 'Cancelar' : 'Borrar'} ${song.title}`}
          onClick={onRemove}
        >
          {song.status === 'analyzing' ? 'Cancelar' : 'Borrar'}
        </Button>
      </div>
    </li>
  )
}

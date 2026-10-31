import { useEffect, useRef, useState } from 'react'
import { formatSignedMs } from '@/game/format'
import { useAnimationFrame } from '@/hooks/useAnimationFrame'
import { parseYouTubeId } from '@/library/youtube'
import { SyncManager } from '@/youtube/SyncManager'
import type { SyncClock } from '@/youtube/SyncManager'
import { YouTubePlayer } from '@/youtube/YouTubePlayer'
import { Chip, IconButton } from '@/ui/primitives'
import { CloseIcon, VideoPlaceholderIcon } from './icons'

// Log de deriva en desarrollo (aceptación de C1: deriva < 40 ms en 3 min)
const DEBUG_LOG_EVERY_MS = 5000
const debugSync = () => {
  try {
    return import.meta.env.DEV || localStorage.getItem('drumhero-debug-sync') === '1'
  } catch {
    return false
  }
}

interface VideoPanelProps {
  youtubeUrl: string | null
  /** Tiempo de video = tiempo de canción + offset (ms). */
  offsetMs: number
  clock: SyncClock
  /** Sin esto no hay botón de ocultar (asistente de sincronía). */
  onHide?: () => void
}

type VideoStatus = 'none' | 'loading' | 'ready' | 'error'

/** Video de YouTube (640×360), siempre silenciado y sincronizado al reloj del MP3. */
export function VideoPanel({ youtubeUrl, offsetMs, clock, onHide }: VideoPanelProps) {
  const videoId = youtubeUrl ? parseYouTubeId(youtubeUrl) : null
  const host = useRef<HTMLDivElement>(null)
  const sync = useRef<SyncManager | null>(null)
  const lastLog = useRef(0)
  const offset = useRef(offsetMs)
  // Un panel por video: el id no cambia durante la partida
  const [loadStatus, setStatus] = useState<Exclude<VideoStatus, 'none'>>('loading')
  const status: VideoStatus = videoId ? loadStatus : 'none'
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const container = host.current
    if (!videoId || !container) return
    // El IFrame API reemplaza el elemento que recibe: se le da uno propio, fuera de React
    const mount = document.createElement('div')
    container.appendChild(mount)
    let player: YouTubePlayer | null = null
    let cancelled = false
    const fail = (message: string) => {
      if (cancelled) return
      sync.current = null
      setError(message)
      setStatus('error')
    }
    YouTubePlayer.create(mount, videoId, fail).then(
      p => {
        if (cancelled) return p.destroy()
        player = p
        sync.current = new SyncManager(p, clock, offset.current)
        setStatus('ready')
      },
      (e: unknown) => fail(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      cancelled = true
      sync.current = null
      player?.destroy()
      // El IFrame API cambia el div por un iframe: se vacía el contenedor entero
      container.replaceChildren()
    }
  }, [videoId, clock])

  // El offset se aplica sin recrear el reproductor
  useEffect(() => {
    offset.current = offsetMs
    sync.current?.setOffset(offsetMs)
  }, [offsetMs])

  useAnimationFrame(nowMs => {
    const manager = sync.current
    if (!manager) return
    manager.tick(nowMs)
    if (nowMs - lastLog.current >= DEBUG_LOG_EVERY_MS && debugSync()) {
      lastLog.current = nowMs
      const { driftMs, maxAbsDriftMs, corrections } = manager.getStats()
      console.debug(
        `[sync] deriva ${driftMs === null ? '—' : `${driftMs.toFixed(1)} ms`} · máx ${maxAbsDriftMs.toFixed(1)} ms · correcciones ${corrections}`,
      )
    }
  }, status === 'ready')

  const chip =
    status === 'none'
      ? youtubeUrl
        ? 'enlace no válido'
        : 'sin video enlazado'
      : status === 'loading'
        ? 'cargando…'
        : status === 'error'
          ? `no disponible: ${error}`
          : `silenciado · sincronizado ${formatSignedMs(offsetMs)}`

  return (
    <div className="relative flex h-[360px] w-[640px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-video">
      {/* pointer-events-none: el video no se controla a mano, sigue al MP3 */}
      <div
        ref={host}
        aria-hidden="true"
        className={status === 'ready' ? 'pointer-events-none absolute inset-0' : 'hidden'}
      />
      {status !== 'ready' && (
        <div className="flex flex-col items-center gap-3 text-faint">
          <VideoPlaceholderIcon />
          <span className="text-[13px]">Video de la canción</span>
        </div>
      )}
      <div className="absolute top-3 left-3 flex max-w-[540px] gap-2">
        <Chip tone="strong">YouTube</Chip>
        <Chip className="truncate">{chip}</Chip>
      </div>
      {onHide && (
        <IconButton
          variant="ghost"
          aria-label="Ocultar video (V)"
          title="Ocultar video (V)"
          onClick={onHide}
          className="absolute top-2.5 right-2.5"
        >
          <CloseIcon />
        </IconButton>
      )}
    </div>
  )
}

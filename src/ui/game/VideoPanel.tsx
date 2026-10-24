import { Chip, IconButton } from '@/ui/primitives'
import { CloseIcon, VideoPlaceholderIcon } from './icons'

interface VideoPanelProps {
  youtubeUrl: string | null
  onHide: () => void
}

/**
 * Hueco del video (640×360). El reproductor de YouTube, siempre silenciado y
 * sincronizado al reloj del MP3, llega en la Fase C; por ahora es un placeholder.
 */
export function VideoPanel({ youtubeUrl, onHide }: VideoPanelProps) {
  return (
    <div className="relative flex h-[360px] w-[640px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-video">
      <div className="absolute top-3 left-3 flex gap-2">
        <Chip tone="strong">YouTube</Chip>
        <Chip>{youtubeUrl ? 'video enlazado · llega en la Fase C' : 'sin video enlazado'}</Chip>
      </div>
      <div className="flex flex-col items-center gap-3 text-faint">
        <VideoPlaceholderIcon />
        <span className="text-[13px]">Video de la canción</span>
      </div>
      <IconButton
        variant="ghost"
        aria-label="Ocultar video (V)"
        title="Ocultar video (V)"
        onClick={onHide}
        className="absolute top-2.5 right-2.5"
      >
        <CloseIcon />
      </IconButton>
    </div>
  )
}

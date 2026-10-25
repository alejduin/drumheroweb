import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { AUDIO_ACCEPT } from '@/library/audioFile'
import { cn } from '@/ui/primitives'

interface DropzoneProps {
  /** Archivo elegido (arrastrado o con el selector); la validación la hace quien lo recibe. */
  onFile: (file: File) => void
  fileName: string | null
  error: string | null
  disabled?: boolean
}

/** Zona para soltar el audio (Importar). */
export function Dropzone({ onFile, fileName, error, disabled = false }: DropzoneProps) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setOver(false)
    const file = e.dataTransfer.files[0]
    if (file && !disabled) onFile(file)
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label="Elegir archivo de audio"
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={e => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          input.current?.click()
        }
      }}
      onDragOver={e => {
        e.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'flex h-[220px] shrink-0 cursor-pointer flex-col items-center justify-center gap-3 rounded-[16px] border-2 border-dashed bg-surface px-6 text-center transition',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        over ? 'border-accent bg-accent-soft' : 'border-border-dashed hover:border-border-strong',
        error && 'border-miss/60',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
        <path
          d="M20 28 V10 M12 18 L20 10 L28 18 M8 30 V33 H32 V30"
          fill="none"
          className="stroke-accent"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {fileName ? (
        <span className="max-w-full truncate text-base font-bold">{fileName}</span>
      ) : (
        <span className="text-base font-bold">Arrastra tu MP3, WAV o M4A</span>
      )}
      <span className="text-[13px] text-muted">
        o{' '}
        <span className="text-accent underline-offset-2 hover:underline">
          {fileName ? 'elige otro archivo' : 'elige un archivo'}
        </span>{' '}
        · máximo 10 minutos
      </span>
      {error && (
        <span role="alert" className="text-[13px] text-miss">
          {error}
        </span>
      )}
      <input
        ref={input}
        type="file"
        accept={AUDIO_ACCEPT}
        className="hidden"
        data-testid="audio-input"
        onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onFile(file)
        }}
      />
    </div>
  )
}

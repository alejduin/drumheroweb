import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { SongBundle } from '@/game/GameSession'
import { useAnalysisWatch } from '@/hooks/useAnalysisWatch'
import { readAudioFile } from '@/library/readAudioFile'
import { parseYouTubeId, youTubeWatchUrl } from '@/library/youtube'
import { useLibraryStore } from '@/store/libraryStore'
import { AnalysisPanel } from '@/ui/library/AnalysisPanel'
import { Dropzone } from '@/ui/library/Dropzone'
import { TextField } from '@/ui/library/TextField'
import { Button, SectionLabel } from '@/ui/primitives'

interface ImportScreenProps {
  onPlay: (bundle: SongBundle, songId: string) => void
  onBack: () => void
  /** Abre el asistente de sincronía del video. */
  onSyncVideo: (songId: string) => void
  /** Abre el editor de partitura. */
  onEdit: (songId: string) => void
  /** Abre el progreso de una canción que ya se está analizando. */
  initialSongId?: string | null
}

interface PickedFile {
  file: File
  durationS: number
}

/** Importar: elegir el audio, analizarlo con el worker y jugarlo (PLAN_V2 B13). */
export function ImportScreen({
  onPlay,
  onBack,
  onSyncVideo,
  onEdit,
  initialSongId = null,
}: ImportScreenProps) {
  const workerStatus = useLibraryStore(s => s.workerStatus)
  const cloud = useLibraryStore(s => s.cloud)
  const checkWorker = useLibraryStore(s => s.checkWorker)
  const importSong = useLibraryStore(s => s.importSong)
  const [picked, setPicked] = useState<PickedFile | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [youtube, setYoutube] = useState('')
  const [songId, setSongId] = useState<string | null>(initialSongId)
  const [submitting, setSubmitting] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [playError, setPlayError] = useState<string | null>(null)
  const song = useLibraryStore(s => (songId ? (s.songs.find(x => x.id === songId) ?? null) : null))
  const tracker = useLibraryStore(s => (songId ? (s.trackers[songId] ?? null) : null))
  const nowMs = useAnalysisWatch(song?.status === 'analyzing')

  useEffect(() => {
    void checkWorker()
    // Reanuda los análisis pendientes si se entra directo a Importar
    if (!useLibraryStore.getState().loaded) void useLibraryStore.getState().load()
  }, [checkWorker])

  // Al cancelar o descartar, la canción desaparece: se vuelve al formulario
  useEffect(() => {
    if (songId && !song && !submitting) setSongId(null)
  }, [song, songId, submitting])

  const youtubeError =
    youtube.trim() && !parseYouTubeId(youtube) ? 'No parece un enlace a un video de YouTube.' : null
  const locked = songId !== null
  const canAnalyze =
    picked !== null && !reading && !youtubeError && !locked && (cloud || workerStatus !== 'offline')

  async function onFile(file: File) {
    setReading(true)
    setFileError(null)
    const info = await readAudioFile(file)
    setReading(false)
    if (!info.ok) {
      setPicked(null)
      setFileError(info.error)
      return
    }
    setPicked({ file, durationS: info.durationS })
    setTitle(info.title)
    setArtist(info.artist)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canAnalyze || !picked) return
    // "te avisamos al terminar": el permiso se pide con el gesto del usuario
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
    setSubmitting(true)
    const id = parseYouTubeId(youtube)
    try {
      setSongId(
        await importSong({
          file: picked.file,
          fileName: picked.file.name,
          title,
          artist,
          durationS: picked.durationS,
          youtubeUrl: id ? youTubeWatchUrl(id) : null,
        }),
      )
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'No se pudo guardar la canción.')
    } finally {
      setSubmitting(false)
    }
  }

  async function play() {
    if (!songId) return
    setPlaying(true)
    setPlayError(null)
    try {
      onPlay(await useLibraryStore.getState().bundle(songId), songId)
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : 'No se pudo abrir la canción.')
      setPlaying(false)
    }
  }

  function reset() {
    setSongId(null)
    setPicked(null)
    setTitle('')
    setArtist('')
    setYoutube('')
    setFileError(null)
  }

  return (
    <main className="flex h-full flex-col gap-7 overflow-y-auto bg-bg p-10 font-sans text-fg">
      <div className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <SectionLabel className="text-xs">Nueva canción</SectionLabel>
          <h1 className="text-[32px] font-extrabold tracking-[-0.02em]">
            Convierte tu canción en partitura
          </h1>
        </div>
        <div className="flex gap-2">
          {locked && (
            <Button size="sm" onClick={reset}>
              Importar otra
            </Button>
          )}
          <Button size="sm" onClick={onBack}>
            ← Biblioteca
          </Button>
        </div>
      </div>

      {workerStatus === 'offline' && cloud && (
        <p
          role="status"
          className="rounded-md border border-close-border bg-close-bg px-4 py-3 text-sm text-close-text"
        >
          El worker de IA de tu PC no está encendido. Puedes importar igual: la canción queda en
          cola y se analiza cuando lo arranques con{' '}
          <code className="font-mono">docker compose up -d cloud-worker</code>.
        </p>
      )}

      {workerStatus === 'offline' && !cloud && (
        <p
          role="alert"
          className="rounded-md border border-close-border bg-close-bg px-4 py-3 text-sm text-close-text"
        >
          No hay conexión con el worker de IA. Arráncalo con{' '}
          <code className="font-mono">docker compose up -d worker</code> (carpeta{' '}
          <code className="font-mono">worker/</code>) y{' '}
          <button
            type="button"
            className="cursor-pointer font-semibold underline underline-offset-2"
            onClick={() => void checkWorker()}
          >
            vuelve a comprobar
          </button>
          . Las canciones ya analizadas se pueden jugar sin él.
        </p>
      )}

      <div className="flex min-h-0 flex-1 gap-7">
        <form onSubmit={onSubmit} className="flex w-[520px] shrink-0 flex-col gap-5">
          <Dropzone
            onFile={f => void onFile(f)}
            fileName={reading ? 'Leyendo…' : (picked?.file.name ?? null)}
            error={fileError}
            disabled={locked || reading}
          />

          <TextField
            id="import-youtube"
            type="url"
            label={
              <>
                Video de YouTube{' '}
                <span className="font-normal text-muted">(opcional, solo para ver)</span>
              </>
            }
            placeholder="https://youtube.com/watch?v=…"
            value={youtube}
            onChange={e => setYoutube(e.target.value)}
            disabled={locked}
            error={youtubeError}
            help="La IA analiza solo tu archivo de audio. El video se reproduce silenciado y sincronizado."
          />

          <div className="flex gap-3">
            <TextField
              id="import-title"
              className="flex-1"
              label="Título"
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={locked}
            />
            <TextField
              id="import-artist"
              className="flex-1"
              label="Artista"
              value={artist}
              onChange={e => setArtist(e.target.value)}
              disabled={locked}
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="h-[50px]"
            disabled={!canAnalyze || submitting}
          >
            {submitting ? 'Guardando…' : 'Analizar con IA'}
          </Button>
          {playError && (
            <p role="alert" className="text-sm text-miss">
              {playError}
            </p>
          )}
        </form>

        <AnalysisPanel
          song={song}
          tracker={tracker}
          pendingFileName={picked?.file.name ?? null}
          playing={playing}
          nowMs={nowMs}
          workerOffline={workerStatus === 'offline'}
          onPlay={() => void play()}
          onSyncVideo={() => songId && onSyncVideo(songId)}
          onEdit={() => songId && onEdit(songId)}
          onRetry={() => songId && useLibraryStore.getState().retry(songId)}
          onCancel={() => songId && void useLibraryStore.getState().cancel(songId)}
        />
      </div>
    </main>
  )
}

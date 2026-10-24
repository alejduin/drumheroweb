import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { SongBundle } from '@/game/GameSession'
import { builtinBundle, localAnalysisBundle } from '@/songs/songBundle'
import { loadChart } from '@/songs/songLoader'
import { SONG_LIBRARY } from '@/songs/songLibrary'
import type { SongMeta } from '@/songs/songLibrary'
import { useProgressStore } from '@/store/progressStore'
import { Button, Panel, Stars } from '@/ui/primitives'

const LEVEL_LABEL: Record<SongMeta['difficulty'], string> = {
  beginner: 'Principiante',
  intermediate: 'Intermedio',
  advanced: 'Avanzado',
}

interface SongSelectScreenProps {
  onSongReady: (bundle: SongBundle) => void
  onBack: () => void
}

export function SongSelectScreen({ onSongReady, onBack }: SongSelectScreenProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bestScores = useProgressStore(s => s.bestScores)
  const fileInput = useRef<HTMLInputElement>(null)

  async function run(key: string, load: () => Promise<SongBundle>) {
    setLoading(key)
    setError(null)
    try {
      onSongReady(await load())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar la canción')
    } finally {
      setLoading(null)
    }
  }

  function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = '' // permite volver a elegir los mismos archivos
    if (files.length > 0) void run('local', () => localAnalysisBundle(files))
  }

  return (
    <main className="flex h-full flex-col bg-bg font-sans text-fg">
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-surface-header px-6">
        <Button size="sm" onClick={onBack}>
          ← Volver
        </Button>
        <h1 className="text-[17px] font-bold">Elegir canción</h1>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto p-6">
        {error && (
          <p
            role="alert"
            className="rounded-md border border-miss/40 bg-miss/10 p-3 text-sm text-fg-2"
          >
            {error}
          </p>
        )}

        <Panel title="Incluidas" aside="sin audio: suena una pista silenciosa">
          {SONG_LIBRARY.map(meta => {
            const best = bestScores[meta.id]
            return (
              <button
                key={meta.id}
                type="button"
                disabled={loading !== null}
                onClick={() =>
                  void run(meta.id, async () => builtinBundle(await loadChart(meta.id)))
                }
                className="flex cursor-pointer items-center justify-between rounded-md bg-surface-2 p-4 text-left transition hover:bg-track disabled:cursor-wait disabled:opacity-50"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-bold">{meta.title}</span>
                  <span className="text-xs text-muted">
                    {meta.artist} · {meta.bpm} BPM · {LEVEL_LABEL[meta.difficulty]}
                  </span>
                </div>
                {loading === meta.id ? (
                  <span className="text-sm text-accent">Cargando…</span>
                ) : best ? (
                  <div className="flex flex-col items-end gap-1">
                    <Stars value={best.stars} size={16} />
                    <span className="font-mono text-xs text-fg-2">
                      {best.score.toLocaleString('en-US')}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-faint">Sin jugar</span>
                )}
              </button>
            )
          })}
        </Panel>

        <Panel title="Análisis local" aside="hasta que llegue la biblioteca">
          <p className="text-xs text-fg-2">
            Elige los archivos de una carpeta de <code className="font-mono">worker/poc/out/…</code>
            : chart.json, drums.ogg, backing.ogg y peaks.json (y el MP3 original, opcional).
          </p>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".json,audio/*,.ogg"
            className="hidden"
            onChange={onFiles}
          />
          <Button
            variant="primary"
            disabled={loading !== null}
            onClick={() => fileInput.current?.click()}
          >
            {loading === 'local' ? 'Cargando…' : 'Abrir archivos del análisis'}
          </Button>
        </Panel>
      </div>
    </main>
  )
}

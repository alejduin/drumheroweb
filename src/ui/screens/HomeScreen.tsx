import { useState } from 'react'
import { sessionSummary } from '@/game/lastSession'
import { DIFFICULTY_LABELS } from '@/game/songMeta'
import { useSessionStore } from '@/store/sessionStore'
import { Button, Panel } from '@/ui/primitives'

interface HomeScreenProps {
  /** Recarga la última canción en su sección; falla si ya no está disponible. */
  onContinue: () => Promise<void>
  onPlay: () => void
  onImport: () => void
  onSettings: () => void
}

export function HomeScreen({ onContinue, onPlay, onImport, onSettings }: HomeScreenProps) {
  const last = useSessionStore(s => s.last)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resume = async () => {
    setLoading(true)
    setError(null)
    try {
      await onContinue()
    } catch (e) {
      setError(
        `No se pudo abrir la última canción${e instanceof Error ? `: ${e.message}` : ''}. Elige otra en la biblioteca.`,
      )
      setLoading(false)
    }
  }

  return (
    <main className="flex h-full flex-col items-center justify-center gap-10 bg-bg px-6 font-sans text-fg select-none">
      <div className="text-center">
        <h1 className="text-6xl font-extrabold tracking-tight text-accent">DrumHero AI</h1>
        <p className="mt-2 text-lg text-muted">Conecta tu batería y toca</p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-4">
        {last && (
          <Panel title="Continuar" aside="tu última sesión">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-bold">{last.title}</span>
                <span className="truncate text-xs text-muted">
                  {last.artist ? `${last.artist} · ` : ''}
                  {sessionSummary(last, DIFFICULTY_LABELS[last.difficulty])}
                </span>
              </div>
              <Button
                variant="primary"
                disabled={loading}
                onClick={() => void resume()}
                className="shrink-0"
              >
                {loading ? 'Cargando…' : 'Continuar'}
              </Button>
            </div>
          </Panel>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-md border border-miss/40 bg-miss/10 p-3 text-sm text-fg-2"
          >
            {error}
          </p>
        )}

        <Button variant={last ? 'secondary' : 'primary'} size="lg" onClick={onPlay}>
          Biblioteca
        </Button>
        <div className="grid grid-cols-2 gap-4">
          <Button onClick={onImport}>Importar canción</Button>
          <Button onClick={onSettings}>Ajustes</Button>
        </div>
      </div>

      <p className="text-sm text-faint">Requiere Chrome o Edge con batería USB-MIDI</p>
    </main>
  )
}

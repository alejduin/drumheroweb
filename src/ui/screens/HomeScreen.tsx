import { Button } from '@/ui/primitives'

interface HomeScreenProps {
  onPlay: () => void
  onImport: () => void
  onSettings: () => void
}

export function HomeScreen({ onPlay, onImport, onSettings }: HomeScreenProps) {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-8 bg-bg font-sans text-fg select-none">
      <div className="text-center">
        <h1 className="text-6xl font-extrabold tracking-tight text-accent">DrumHero AI</h1>
        <p className="mt-2 text-lg text-muted">Conecta tu batería y toca</p>
      </div>

      <div className="flex w-64 flex-col gap-4">
        <Button variant="primary" size="lg" onClick={onPlay}>
          Jugar
        </Button>
        <Button onClick={onImport}>Importar canción</Button>
        <Button onClick={onSettings}>Ajustes</Button>
      </div>

      <p className="text-sm text-faint">Requiere Chrome o Edge con batería USB-MIDI</p>
    </main>
  )
}

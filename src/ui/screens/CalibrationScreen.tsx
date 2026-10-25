import { useEffect } from 'react'
import { LatencyPanel } from '@/ui/calibration/LatencyPanel'
import { MidiMappingPanel } from '@/ui/calibration/MidiMappingPanel'
import { MidiStatusPill } from '@/ui/game/MidiStatusPill'
import { Button } from '@/ui/primitives'

interface CalibrationScreenProps {
  onBack: () => void
}

/** Calibración (PLAN_V2 B10): latencia del kit + mapeo MIDI por pieza. */
export function CalibrationScreen({ onBack }: CalibrationScreenProps) {
  // Esc = volver (no se usa mientras se escribe: aquí no hay campos de texto)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && !e.repeat) onBack()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onBack])

  return (
    <main className="flex h-full flex-col bg-bg font-sans text-fg select-none">
      <header className="flex items-center gap-4 border-b border-border bg-surface-header px-6 py-4">
        <Button size="sm" onClick={onBack}>
          ← Volver
        </Button>
        <h1 className="text-lg font-bold">Calibración</h1>
        <div className="ml-auto">
          <MidiStatusPill />
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-start gap-6 p-6 lg:grid-cols-2">
          <LatencyPanel />
          <MidiMappingPanel />
        </div>
      </div>
    </main>
  )
}

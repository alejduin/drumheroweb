import { LEVEL_WINDOWS } from '@/constants/scoring'
import type { Level } from '@/types'
import { useSettingsStore } from '@/store/settingsStore'
import { Button, SegmentedControl } from '@/ui/primitives'

const LEVEL_OPTIONS: { value: Level; label: string }[] = [
  { value: 'beginner', label: 'Principiante' },
  { value: 'intermediate', label: 'Intermedio' },
  { value: 'expert', label: 'Experto' },
]

interface SettingsScreenProps {
  onBack: () => void
  onCalibrate: () => void
}

export function SettingsScreen({ onBack, onCalibrate }: SettingsScreenProps) {
  const {
    midiLatencyOffsetMs,
    level,
    mix,
    scrollSpeed,
    setLatencyOffset,
    setLevel,
    setMixLevel,
    setScrollSpeed,
  } = useSettingsStore()
  const windows = LEVEL_WINDOWS[level]

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white select-none">
      {/* Header */}
      <div className="flex items-center gap-4 p-6 border-b border-gray-800">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-white transition-colors text-sm"
        >
          ← Volver
        </button>
        <h2 className="text-2xl font-bold">Ajustes</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-8 max-w-lg">
        {/* Latencia MIDI */}
        <section>
          <h3 className="text-gray-400 text-xs uppercase tracking-widest mb-4">MIDI</h3>
          <SettingRow
            label="Offset de latencia"
            hint="Lo mide la calibración; aquí se ajusta a mano. Positivo = los golpes llegan tarde."
            value={`${midiLatencyOffsetMs} ms`}
          >
            <input
              type="range"
              min={-150}
              max={150}
              step={1}
              value={midiLatencyOffsetMs}
              onChange={e => setLatencyOffset(Number(e.target.value))}
              className="w-full accent-purple-500"
            />
            <div className="flex justify-between text-xs text-gray-600 mt-1">
              <span>-150 ms</span>
              <span>0</span>
              <span>+150 ms</span>
            </div>
          </SettingRow>
          <Button size="sm" className="mt-4" onClick={onCalibrate}>
            Calibrar latencia y mapeo MIDI
          </Button>
        </section>

        {/* Nivel */}
        <section>
          <h3 className="text-gray-400 text-xs uppercase tracking-widest mb-4">Nivel</h3>
          <SettingRow
            label="Ventanas de acierto"
            hint="Qué tan exacto tienes que ser. La dificultad (qué notas hay) se elige en cada partida."
            value={`±${windows.perfectMs} / ±${windows.closeMs} ms`}
          >
            <SegmentedControl
              aria-label="Nivel"
              options={LEVEL_OPTIONS}
              value={level}
              onChange={setLevel}
              fullWidth
            />
          </SettingRow>
        </section>

        {/* Audio */}
        <section>
          <h3 className="text-gray-400 text-xs uppercase tracking-widest mb-4">Audio</h3>
          <SettingRow
            label="Volumen metrónomo"
            hint="También se ajusta en el mezclador de la partida."
            value={`${Math.round(mix.metronome * 100)}%`}
          >
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={mix.metronome}
              onChange={e => setMixLevel('metronome', Number(e.target.value))}
              className="w-full accent-purple-500"
            />
          </SettingRow>
        </section>

        {/* Visualización */}
        <section>
          <h3 className="text-gray-400 text-xs uppercase tracking-widest mb-4">Visualización</h3>
          <SettingRow
            label="Velocidad de scroll"
            hint="Multiplica la velocidad base de las notas cayendo."
            value={`${scrollSpeed.toFixed(1)}x`}
          >
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={scrollSpeed}
              onChange={e => setScrollSpeed(Number(e.target.value))}
              className="w-full accent-purple-500"
            />
            <div className="flex justify-between text-xs text-gray-600 mt-1">
              <span>0.5x</span>
              <span>1x</span>
              <span>2x</span>
            </div>
          </SettingRow>
        </section>
      </div>
    </div>
  )
}

function SettingRow({
  label,
  hint,
  value,
  children,
}: {
  label: string
  hint?: string
  value: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <span className="font-medium">{label}</span>
          {hint && <p className="text-gray-500 text-xs mt-0.5">{hint}</p>}
        </div>
        <span className="text-purple-400 font-mono text-sm ml-4 shrink-0">{value}</span>
      </div>
      {children}
    </div>
  )
}

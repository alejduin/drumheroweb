import { useSettingsStore } from '@/store/settingsStore'

interface SettingsScreenProps {
  onBack: () => void
}

export function SettingsScreen({ onBack }: SettingsScreenProps) {
  const {
    midiLatencyOffsetMs,
    metronomeVolume,
    sampleVolume,
    scrollSpeed,
    setLatencyOffset,
    setMetronomeVolume,
    setSampleVolume,
    setScrollSpeed,
  } = useSettingsStore()

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
            hint="Ajusta si los golpes se registran tarde o temprano. Positivo = compensar retardo."
            value={`${midiLatencyOffsetMs} ms`}
          >
            <input
              type="range"
              min={-100}
              max={100}
              step={1}
              value={midiLatencyOffsetMs}
              onChange={e => setLatencyOffset(Number(e.target.value))}
              className="w-full accent-purple-500"
            />
            <div className="flex justify-between text-xs text-gray-600 mt-1">
              <span>-100 ms</span>
              <span>0</span>
              <span>+100 ms</span>
            </div>
          </SettingRow>
        </section>

        {/* Audio */}
        <section>
          <h3 className="text-gray-400 text-xs uppercase tracking-widest mb-4">Audio</h3>
          <div className="flex flex-col gap-6">
            <SettingRow
              label="Volumen metrónomo"
              hint="Pon a 0 para desactivar el metrónomo durante el juego."
              value={`${Math.round(metronomeVolume * 100)}%`}
            >
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={metronomeVolume}
                onChange={e => setMetronomeVolume(Number(e.target.value))}
                className="w-full accent-purple-500"
              />
            </SettingRow>

            <SettingRow label="Volumen samples" value={`${Math.round(sampleVolume * 100)}%`}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={sampleVolume}
                onChange={e => setSampleVolume(Number(e.target.value))}
                className="w-full accent-purple-500"
              />
            </SettingRow>
          </div>
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

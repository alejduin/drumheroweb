import type { ReactNode } from 'react'
import { LEVEL_WINDOWS } from '@/constants/scoring'
import { ACCENTS } from '@/constants/theme'
import type { AccentName } from '@/constants/theme'
import type { Level, ScoreView } from '@/types'
import { formatSignedMs } from '@/game/format'
import { LEVEL_LABELS } from '@/game/songMeta'
import { useSettingsStore } from '@/store/settingsStore'
import { WEEKLY_GOAL_OPTIONS } from '@/progress/history'
import { Button, Panel, SegmentedControl, Slider } from '@/ui/primitives'
import { cn } from '@/ui/primitives/cn'

const LEVEL_OPTIONS = (['beginner', 'intermediate', 'expert'] as const).map(value => ({
  value,
  label: LEVEL_LABELS[value],
}))

const VIEW_OPTIONS: { value: ScoreView; label: string }[] = [
  { value: 'staff', label: 'Pentagrama' },
  { value: 'lanes', label: 'Carriles' },
]

const ACCENT_LABELS: Record<AccentName, string> = {
  violet: 'Violeta',
  blue: 'Azul',
  pink: 'Rosa',
}

// Slider entero: la velocidad de scroll va de 0.5x a 2x en pasos de 0.1x
const SCROLL_STEPS = 10

interface SettingsScreenProps {
  onBack: () => void
  onCalibrate: () => void
}

export function SettingsScreen({ onBack, onCalibrate }: SettingsScreenProps) {
  const {
    midiLatencyOffsetMs,
    level,
    view,
    scrollSpeed,
    accent,
    mix,
    weeklyGoalMin,
    setWeeklyGoal,
    setLatencyOffset,
    setLevel,
    setView,
    setScrollSpeed,
    setAccent,
    setMixLevel,
  } = useSettingsStore()
  const windows = LEVEL_WINDOWS[level]
  const metronomePct = Math.round(mix.metronome * 100)

  return (
    <main className="flex h-full flex-col bg-bg font-sans text-fg select-none">
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-surface-header px-6">
        <Button size="sm" onClick={onBack}>
          ← Volver
        </Button>
        <h1 className="flex-1 text-[17px] font-bold">Ajustes</h1>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto p-6">
        <Panel title="Juego">
          <SettingRow
            label="Nivel"
            hint="Qué tan exacto tienes que ser. La dificultad (qué notas hay) se elige en cada partida."
            value={`±${windows.perfectMs} / ±${windows.closeMs} ms`}
          >
            <SegmentedControl<Level>
              aria-label="Nivel"
              options={LEVEL_OPTIONS}
              value={level}
              onChange={setLevel}
              fullWidth
            />
          </SettingRow>
          <SettingRow
            label="Meta semanal"
            hint="Minutos de práctica por semana (de lunes a domingo). Se ve en la portada."
            value={`${weeklyGoalMin} min`}
          >
            <SegmentedControl<string>
              aria-label="Meta semanal"
              options={WEEKLY_GOAL_OPTIONS.map(m => ({ value: String(m), label: `${m}` }))}
              value={String(weeklyGoalMin)}
              onChange={v => setWeeklyGoal(Number(v))}
              fullWidth
            />
          </SettingRow>
        </Panel>

        <Panel title="Partitura">
          <SettingRow label="Vista" hint="También se cambia desde la partitura.">
            <SegmentedControl<ScoreView>
              aria-label="Vista"
              options={VIEW_OPTIONS}
              value={view}
              onChange={setView}
              fullWidth
            />
          </SettingRow>
          <SettingRow
            label="Velocidad de scroll"
            hint="Más rápido separa más las notas."
            value={`${scrollSpeed.toFixed(1)}x`}
          >
            <Slider
              aria-label="Velocidad de scroll"
              min={0.5 * SCROLL_STEPS}
              max={2 * SCROLL_STEPS}
              value={Math.round(scrollSpeed * SCROLL_STEPS)}
              valueText={`${scrollSpeed.toFixed(1)}x`}
              onChange={v => setScrollSpeed(v / SCROLL_STEPS)}
            />
          </SettingRow>
        </Panel>

        <Panel title="Apariencia">
          <SettingRow label="Color de acento">
            <div role="radiogroup" aria-label="Color de acento" className="flex gap-3">
              {(Object.keys(ACCENTS) as AccentName[]).map(name => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={accent === name}
                  onClick={() => setAccent(name)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs transition',
                    accent === name
                      ? 'border-fg-2 bg-surface-2 text-fg'
                      : 'border-border text-muted hover:bg-surface-2',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="size-3.5 rounded-full"
                    style={{ background: ACCENTS[name].accent }}
                  />
                  {ACCENT_LABELS[name]}
                </button>
              ))}
            </div>
          </SettingRow>
        </Panel>

        <Panel title="MIDI y audio">
          <SettingRow
            label="Latencia del kit"
            hint="La mide la calibración; aquí se ajusta a mano. Positivo = los golpes llegan tarde."
            value={formatSignedMs(midiLatencyOffsetMs)}
          >
            <Slider
              aria-label="Latencia del kit"
              min={-150}
              max={150}
              value={midiLatencyOffsetMs}
              valueText={formatSignedMs(midiLatencyOffsetMs)}
              onChange={setLatencyOffset}
            />
          </SettingRow>
          <Button size="sm" className="self-start" onClick={onCalibrate}>
            Calibrar latencia y mapeo MIDI
          </Button>
          <SettingRow
            label="Volumen del metrónomo"
            hint="También se ajusta en el mezclador de la partida."
            value={`${metronomePct}%`}
          >
            <Slider
              aria-label="Volumen del metrónomo"
              tone="light"
              step={5}
              value={metronomePct}
              valueText={`${metronomePct} %`}
              onChange={v => setMixLevel('metronome', v / 100)}
            />
          </SettingRow>
        </Panel>
      </div>
    </main>
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
  value?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">{label}</span>
          {hint && <span className="text-xs text-muted">{hint}</span>}
        </div>
        {value && <span className="shrink-0 font-mono text-sm text-accent">{value}</span>}
      </div>
      {children}
    </div>
  )
}

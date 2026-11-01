import { matchingPreset } from '@/audio/Mixer'
import { MAX_TEMPO, MIN_TEMPO, TEMPO_STEP } from '@/audio/timeStretch'
import type { MixChannel, MixLevels, MixPreset } from '@/audio/Mixer'
import { DIFFICULTIES } from '@/types'
import type { Difficulty, Piece } from '@/types'
import type { AudioMode } from '@/game/GameSession'
import { lapText, waitText } from '@/game/practice'
import type { LapResult, PracticeLoop } from '@/game/practice'
import { formatSignedMs } from '@/game/format'
import { DIFFICULTY_LABELS } from '@/game/songMeta'
import { Button, Checkbox, Panel, SectionLabel, SegmentedControl, Slider } from '@/ui/primitives'

const PRESET_LABELS: Record<MixPreset, string> = {
  play_drums: 'Tocar yo la batería',
  listen: 'Escuchar la canción',
  transcription: 'Escuchar la transcripción',
}

const MIX_ROWS: ReadonlyArray<{ channel: MixChannel; label: string }> = [
  { channel: 'drums', label: 'Batería original' },
  { channel: 'backing', label: 'Backing' },
  { channel: 'metronome', label: 'Metrónomo' },
  { channel: 'samples', label: 'Samples del kit' },
]

interface SessionSettingsPanelProps {
  difficulty: Difficulty
  /** Notas de cada dificultad: una vacía no se puede elegir. */
  difficultyCounts: Readonly<Record<Difficulty, number>>
  onDifficultyChange: (difficulty: Difficulty) => void
  /** Tempo elegido (0,5–1). */
  tempo: number
  /** Las pistas se están estirando al tempo elegido. */
  tempoPending: boolean
  /** Por qué no se pudo aplicar el último tempo, si falló. */
  tempoError: string | null
  onTempoChange: (tempo: number) => void
  tempoRamp: boolean
  onTempoRampChange: (on: boolean) => void
  /** Loop activo (la rampa solo actúa con loop). */
  loop: PracticeLoop | null
  lastLap: LapResult | null
  mix: Readonly<MixLevels>
  audioMode: AudioMode
  onMixChange: (channel: MixChannel, level: number) => void
  videoOffsetMs: number
  latencyMs: number
  onRecalibrate: () => void
  dynamicsBonus: boolean
  onDynamicsBonusChange: (on: boolean) => void
  waitMode: boolean
  onWaitModeChange: (on: boolean) => void
  /** Piezas que faltan para seguir; null = no está detenida. */
  waitingFor: readonly Piece[] | null
}

export function SessionSettingsPanel({
  difficulty,
  difficultyCounts,
  onDifficultyChange,
  tempo,
  tempoPending,
  tempoError,
  onTempoChange,
  tempoRamp,
  onTempoRampChange,
  loop,
  lastLap,
  mix,
  audioMode,
  onMixChange,
  videoOffsetMs,
  latencyMs,
  onRecalibrate,
  dynamicsBonus,
  onDynamicsBonusChange,
  waitMode,
  onWaitModeChange,
  waitingFor,
}: SessionSettingsPanelProps) {
  const preset = matchingPreset(mix)
  const difficultyOptions = DIFFICULTIES.map(value => ({
    value,
    label: DIFFICULTY_LABELS[value],
    disabled: difficultyCounts[value] === 0,
  }))
  const noStems = audioMode !== 'stems'
  const tempoPct = Math.round(tempo * 100)
  return (
    <Panel
      as="aside"
      aria-label="Configuración"
      title="Configuración"
      className="min-w-[300px] flex-1 gap-4 overflow-y-auto"
    >
      <div className="flex flex-col gap-2">
        <SectionLabel>Dificultad</SectionLabel>
        <SegmentedControl
          aria-label="Dificultad"
          options={difficultyOptions}
          value={difficulty}
          onChange={onDifficultyChange}
          fullWidth
        />
        <span className="text-[11px] text-muted">
          {difficultyCounts[difficulty]} notas · cambiarla reinicia el marcador
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex justify-between">
          <SectionLabel>Tempo</SectionLabel>
          <span className="font-mono text-xs">{tempoPct}%</span>
        </div>
        <Slider
          aria-label="Tempo"
          value={tempoPct}
          valueText={`${tempoPct} %`}
          min={MIN_TEMPO * 100}
          max={MAX_TEMPO * 100}
          step={TEMPO_STEP * 100}
          onChange={v => onTempoChange(v / 100)}
        />
        <span className="text-[11px] text-muted" aria-live="polite">
          {tempoPending
            ? `Preparando el audio al ${tempoPct} %…`
            : (tempoError ?? 'Más lento sin cambiar el tono · las ventanas siguen en tiempo real')}
        </span>
        <Checkbox
          label="Rampa +5% al lograr 90%"
          checked={tempoRamp}
          onChange={onTempoRampChange}
        />
        <span className="text-[11px] text-muted" aria-live="polite">
          {lapText(loop, lastLap, tempoRamp)}
        </span>
      </div>

      <div className="flex flex-col gap-2.5">
        <SectionLabel>Mezclador</SectionLabel>
        {MIX_ROWS.map(({ channel, label }) => {
          const disabled = channel === 'drums' && noStems
          const pct = Math.round(mix[channel] * 100)
          return (
            <div
              key={channel}
              className="flex items-center gap-2.5 text-xs"
              title={disabled ? 'Sin stems: suena el audio completo en Backing' : undefined}
            >
              <span className="w-[104px] shrink-0 text-fg-2">{label}</span>
              <Slider
                aria-label={label}
                tone="light"
                value={pct}
                valueText={`${pct} %`}
                onChange={v => onMixChange(channel, v / 100)}
                disabled={disabled}
              />
              <span className="w-[34px] shrink-0 text-right font-mono">{pct}%</span>
            </div>
          )
        })}
        <span className="text-[11px] text-muted">
          Preset: {preset ? PRESET_LABELS[preset] : 'Personalizado'}
          {audioMode === 'silent' && ' · canción sin audio'}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Sincronía</SectionLabel>
        <div className="flex justify-between text-xs">
          <span className="text-fg-2">Offset del video</span>
          <span className="font-mono">{formatSignedMs(videoOffsetMs)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-fg-2">Latencia del kit</span>
          <span className="font-mono">{Math.round(latencyMs)} ms</span>
        </div>
        <Button size="sm" onClick={onRecalibrate}>
          Recalibrar
        </Button>
      </div>

      <div className="flex flex-col gap-2.5 border-t border-border pt-3.5">
        <Checkbox label="Modo espera" checked={waitMode} onChange={onWaitModeChange} />
        {waitMode && (
          <span className="-mt-1 text-[11px] text-muted" aria-live="polite">
            {waitText(waitingFor)}
          </span>
        )}
        <Checkbox
          label="Puntos por dinámica"
          checked={dynamicsBonus}
          onChange={onDynamicsBonusChange}
        />
      </div>
    </Panel>
  )
}

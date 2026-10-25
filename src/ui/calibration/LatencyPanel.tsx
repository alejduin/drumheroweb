import { useEffect, useState } from 'react'
import {
  CALIBRATION_HITS,
  COUNT_IN_BEATS,
  isConsistent,
  MIN_LATENCY_SAMPLES,
} from '@/calibration/latency'
import { LatencyCalibration } from '@/calibration/LatencyCalibration'
import type { CalibrationProgress } from '@/calibration/LatencyCalibration'
import { formatSignedMs } from '@/game/format'
import { midiManager } from '@/midi/MidiManager'
import { useSettingsStore } from '@/store/settingsStore'
import { Button, cn, Panel, SectionLabel } from '@/ui/primitives'

/** Una muestra a menos de esto del click se pinta en verde. */
const ON_TIME_MS = 20

const PHASE_TEXT: Record<CalibrationProgress['phase'], string> = {
  'count-in': 'Escucha la entrada…',
  measuring: 'Golpea con cada click',
  done: 'Listo',
}

/** Latencia del kit: 4 clicks de entrada + 8 golpes; se descarta el peor y se promedia. */
export function LatencyPanel() {
  const savedMs = useSettingsStore(s => s.midiLatencyOffsetMs)
  const setLatencyOffset = useSettingsStore(s => s.setLatencyOffset)
  const [run, setRun] = useState<LatencyCalibration | null>(null)
  const [progress, setProgress] = useState<CalibrationProgress | null>(null)
  // Resultados de esta visita: sirven para comprobar la repetibilidad (±5 ms)
  const [history, setHistory] = useState<number[]>([])

  useEffect(() => () => run?.dispose(), [run])

  const start = () => {
    const calibration = new LatencyCalibration({
      subscribeNoteOn: callback => midiManager.onNoteOn(callback),
    })
    calibration.subscribe(p => {
      setProgress(p)
      if (p.phase === 'done' && p.result) {
        const { latencyMs } = p.result
        setHistory(h => [...h, latencyMs])
      }
    })
    setProgress(calibration.state)
    setRun(calibration)
    void calibration.start()
  }

  const running = progress !== null && progress.phase !== 'done'
  const result = progress?.phase === 'done' ? progress.result : null
  const hits = progress?.samples.filter(s => s !== null).length ?? 0

  return (
    <Panel title="Latencia del kit" aside={`Guardada: ${formatSignedMs(savedMs)}`}>
      <p className="text-sm text-fg-2">
        Escucharás {COUNT_IN_BEATS} clicks de entrada y luego {CALIBRATION_HITS} clicks. Golpea
        cualquier pad (la caja, por ejemplo) justo con cada click. Usa auriculares o los altavoces
        con los que juegas.
      </p>

      <ClickRow progress={progress} />

      <div className="min-h-[72px] rounded-md border border-border bg-surface-inset p-3.5">
        {progress === null && (
          <p className="text-sm text-muted">Pulsa Empezar cuando estés listo con las baquetas.</p>
        )}
        {running && (
          <p className="text-sm text-fg-2" aria-live="polite">
            {PHASE_TEXT[progress.phase]} · {hits} de {CALIBRATION_HITS} golpes
          </p>
        )}
        {progress?.phase === 'done' && !result && (
          <p className="text-sm text-close-text">
            Solo {hits} de {CALIBRATION_HITS} golpes cerca de los clicks (mínimo{' '}
            {MIN_LATENCY_SAMPLES}). Repite la prueba.
          </p>
        )}
        {result && (
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <SectionLabel>Latencia medida</SectionLabel>
              <p className="font-mono text-3xl font-bold text-fg">
                {formatSignedMs(result.latencyMs)}
              </p>
            </div>
            <div className="text-right text-xs text-muted">
              <p>dispersión {Math.round(result.spreadMs)} ms</p>
              <p>descartado {formatSignedMs(result.discarded)}</p>
              {!isConsistent(result) && (
                <p className="mt-1 text-close-text">Golpes irregulares: conviene repetir</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button variant={result ? 'secondary' : 'primary'} onClick={start} disabled={running}>
          {progress === null ? 'Empezar' : 'Repetir'}
        </Button>
        {result && (
          <Button
            variant="primary"
            onClick={() => setLatencyOffset(result.latencyMs)}
            disabled={result.latencyMs === savedMs}
          >
            {result.latencyMs === savedMs
              ? 'Guardada'
              : `Guardar ${formatSignedMs(result.latencyMs)}`}
          </Button>
        )}
        {history.length > 1 && (
          <span className="ml-auto font-mono text-xs text-muted">
            Corridas: {history.map(formatSignedMs).join(' · ')}
          </span>
        )}
      </div>
    </Panel>
  )
}

/** Clicks de entrada y medidos; bajo cada medido, su desfase. */
function ClickRow({ progress }: { progress: CalibrationProgress | null }) {
  const total = COUNT_IN_BEATS + CALIBRATION_HITS
  const discarded = progress?.result?.discarded
  return (
    <ol className="flex items-start gap-2" aria-label="Clicks">
      {Array.from({ length: total }, (_, i) => {
        const countIn = i < COUNT_IN_BEATS
        const sample = countIn ? null : (progress?.samples[i - COUNT_IN_BEATS] ?? null)
        const current = progress !== null && progress.phase !== 'done' && progress.beat === i
        const passed = progress !== null && (progress.phase === 'done' || progress.beat > i)
        return (
          <li key={i} className="flex w-11 flex-col items-center gap-1.5">
            <span
              className={cn(
                'size-6 rounded-full border-2 transition',
                countIn ? 'border-border-strong' : 'border-border-dashed',
                current && 'scale-110 border-accent bg-accent-soft',
                sample !== null &&
                  (Math.abs(sample) <= ON_TIME_MS
                    ? 'border-perfect-fg bg-perfect-bg'
                    : 'border-close-fg bg-close-bg'),
                !countIn && sample === null && passed && !current && 'border-miss/60',
              )}
            />
            <span
              className={cn(
                'font-mono text-[10px] whitespace-nowrap',
                sample === discarded && sample !== null ? 'text-faint line-through' : 'text-muted',
              )}
            >
              {countIn ? i + 1 : sample === null ? '·' : formatSignedMs(sample).replace(' ms', '')}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

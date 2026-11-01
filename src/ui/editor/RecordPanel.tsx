import { useEffect, useRef, useState } from 'react'
import type { MixLevels } from '@/audio/Mixer'
import { MIX_CHANNELS } from '@/audio/Mixer'
import { recordingPhase, recordingPlan } from '@/editor/recording'
import type { RecordedHit, RecordingPlan } from '@/editor/recording'
import type { GameSession } from '@/game/GameSession'
import { midiManager } from '@/midi/MidiManager'
import { useSettingsStore } from '@/store/settingsStore'
import { Button } from '@/ui/primitives'

// Mientras se graba: sin la batería original ni el kit de la app (suena el módulo),
// con metrónomo para la cuenta y para no perderse
const RECORD_MIX: Partial<MixLevels> = { drums: 0, samples: 0, metronome: 0.6 }

const INPUT_CLASS =
  'h-9 w-20 rounded-md border border-border bg-surface-2 px-2 text-sm text-fg disabled:opacity-50'

type Status = 'idle' | 'countIn' | 'recording'

interface RecordPanelProps {
  session: GameSession
  /** Compás que se está mirando (para proponer el rango). */
  currentMeasure: () => number
  onRecorded: (fromMeasure: number, toMeasure: number, hits: RecordedHit[]) => void
}

/**
 * "Grabar con mi kit" (PLAN_V2 C5): un compás de cuenta y se graba la MIDI del
 * rango. Los golpes se toman con su propio timestamp sobre el reloj del MP3.
 */
export function RecordPanel({ session, currentMeasure, onRecorded }: RecordPanelProps) {
  const { chart } = session
  const measures = chart.grid.downbeats.length
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(Math.min(2, measures))
  const [status, setStatus] = useState<Status>('idle')
  const [hitCount, setHitCount] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  // La grabación en curso vive en un ref: la leen el RAF y los golpes MIDI
  const active = useRef<{
    plan: RecordingPlan
    from: number
    to: number
    hits: RecordedHit[]
    mix: MixLevels
    stop: () => void
  } | null>(null)

  // Al salir del editor a mitad de una grabación, se corta sin aplicar nada
  useEffect(() => () => active.current?.stop(), [])

  function restore(mix: MixLevels) {
    for (const channel of MIX_CHANNELS) session.setMixLevel(channel, mix[channel])
  }

  function finish(apply: boolean) {
    const rec = active.current
    if (!rec) return
    active.current = null
    rec.stop()
    session.pause()
    restore(rec.mix)
    setStatus('idle')
    if (!apply) {
      setMessage('Grabación cancelada: la partitura no cambió.')
      return
    }
    const hits = rec.hits.filter(h => h.t >= rec.plan.startS - 0.25)
    if (!hits.length) {
      setMessage('No se grabó ningún golpe: la partitura no cambió. ¿Está conectado el kit?')
      return
    }
    onRecorded(rec.from, rec.to, hits)
    setMessage(
      `Listo: ${hits.length} ${hits.length === 1 ? 'golpe' : 'golpes'} en los compases ${rec.from}–${rec.to}. Deshacer lo revierte.`,
    )
  }

  function start() {
    if (!measures) return
    const a = Math.min(Math.max(Math.round(from), 1), measures)
    const b = Math.min(Math.max(Math.round(to), a), measures)
    setFrom(a)
    setTo(b)
    const plan = recordingPlan(chart.grid, chart.durationS, a, b)
    const hits: RecordedHit[] = []
    session.pause()

    const unsubscribe = midiManager.onHit(hit => {
      if (!active.current) return
      // La latencia es tiempo real: a otro tempo equivale a latencia × rate de canción
      const latencyS =
        (useSettingsStore.getState().midiLatencyOffsetMs / 1000) * session.clock.playbackRate
      hits.push({
        t: session.clock.perfToSong(hit.timestamp) - latencyS,
        piece: hit.instrument,
        velocity: hit.velocity,
      })
      setHitCount(hits.length)
    })
    // RAF solo para seguir la fase y cortar al final; el tiempo lo da el reloj del MP3
    let frameId = 0
    let last: Status = 'countIn'
    const frame = () => {
      frameId = requestAnimationFrame(frame)
      if (!active.current) return
      // Pausar a mano (Espacio) cancela
      if (!session.isPlaying) {
        finish(false)
        return
      }
      const phase = recordingPhase(plan, session.clock.now())
      if (phase === 'done') {
        finish(true)
        return
      }
      if (phase !== last) {
        last = phase
        setStatus(phase)
      }
    }

    active.current = {
      plan,
      from: a,
      to: b,
      hits,
      mix: { ...session.mixer.levels },
      stop: () => {
        unsubscribe()
        cancelAnimationFrame(frameId)
      },
    }
    setHitCount(0)
    setMessage(null)
    setStatus('countIn')
    session.setMixLevel('drums', RECORD_MIX.drums!)
    session.setMixLevel('samples', RECORD_MIX.samples!)
    session.setMixLevel('metronome', RECORD_MIX.metronome!)
    session.seek(plan.playFromS)
    void session.play().then(() => {
      frameId = requestAnimationFrame(frame)
    })
  }

  const busy = status !== 'idle'

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
      <span className="w-full text-sm font-semibold">Grabar con mi kit</span>
      <label className="flex items-center gap-2 text-sm text-fg-2">
        Compases
        <input
          type="number"
          aria-label="Desde el compás"
          className={INPUT_CLASS}
          min={1}
          max={measures}
          value={from}
          disabled={busy}
          onChange={e => {
            const v = Number(e.target.value)
            setFrom(v)
            if (v > to) setTo(v)
          }}
        />
        a
        <input
          type="number"
          aria-label="Hasta el compás"
          className={INPUT_CLASS}
          min={1}
          max={measures}
          value={to}
          disabled={busy}
          onChange={e => setTo(Number(e.target.value))}
        />
      </label>
      <Button
        size="sm"
        disabled={busy}
        onClick={() => {
          const m = Math.min(Math.max(currentMeasure(), 1), measures)
          setFrom(m)
          setTo(m)
        }}
      >
        Compás visible
      </Button>
      {busy ? (
        <Button size="sm" onClick={() => finish(false)}>
          Cancelar
        </Button>
      ) : (
        <Button size="sm" variant="primary" disabled={!measures} onClick={start}>
          ● Grabar
        </Button>
      )}
      <span className="w-full text-xs text-muted" aria-live="polite">
        {status === 'countIn'
          ? 'Cuenta: un compás con metrónomo…'
          : status === 'recording'
            ? `Grabando… ${hitCount} ${hitCount === 1 ? 'golpe' : 'golpes'}`
            : (message ??
              'Suena un compás de cuenta y se graba lo que tocas. Reemplaza las notas de esos compases, ajustadas a la rejilla.')}
      </span>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MIX_CHANNELS } from '@/audio/Mixer'
import type { MixLevels } from '@/audio/Mixer'
import type { GameSession, SessionOptions, SongBundle } from '@/game/GameSession'
import { formatSignedMs } from '@/game/format'
import { useGameSession } from '@/hooks/useGameSession'
import { useLibraryBundle } from '@/hooks/useLibraryBundle'
import { midiManager } from '@/midi/MidiManager'
import { selectPhase, useGameStore } from '@/store/gameStore'
import { useLibraryStore } from '@/store/libraryStore'
import { useSettingsStore } from '@/store/settingsStore'
import { VideoPanel } from '@/ui/game/VideoPanel'
import { Button, Panel, SectionLabel } from '@/ui/primitives'
import {
  COARSE_STEP_MS,
  FINE_STEP_MS,
  MIN_TAPS,
  estimateOffset,
  kickTimes,
  previewStartS,
} from '@/youtube/offset'
import type { OffsetEstimate } from '@/youtube/offset'

// Durante el marcado no suena nada: el usuario sigue el video con la vista
const SILENT_MIX: MixLevels = { drums: 0, backing: 0, metronome: 0, samples: 0 }

function silence(session: GameSession) {
  for (const channel of MIX_CHANNELS) session.setMixLevel(channel, 0)
}

function readOptions(): SessionOptions {
  const s = useSettingsStore.getState()
  return {
    difficulty: 'full',
    level: s.level,
    latencyMs: s.midiLatencyOffsetMs,
    dynamicsBonus: false,
    mix: SILENT_MIX,
  }
}

interface SyncWizardProps {
  /** Canción de la biblioteca a sincronizar. */
  songId: string
  onDone: () => void
}

/** Asistente de sincronía del video (PLAN_V2 C2): carga la canción y abre el asistente. */
export function SyncWizard({ songId, onDone }: SyncWizardProps) {
  const state = useLibraryBundle(songId)
  if (state.status === 'ready') {
    return <WizardSession bundle={state.bundle} songId={songId} onDone={onDone} />
  }
  return (
    <Status
      message={state.status === 'error' ? state.message : 'Cargando la canción…'}
      onBack={state.status === 'error' ? onDone : undefined}
    />
  )
}

function Status({ message, onBack }: { message: string; onBack?: () => void }) {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 bg-bg font-sans text-fg">
      <p className="max-w-lg text-center text-sm text-fg-2">{message}</p>
      {onBack && <Button onClick={onBack}>Volver</Button>}
    </main>
  )
}

function WizardSession({ bundle, songId, onDone }: SyncWizardProps & { bundle: SongBundle }) {
  const state = useGameSession(bundle, readOptions)
  if (state.status === 'ready') {
    return <WizardLayout session={state.session} songId={songId} onDone={onDone} />
  }
  return (
    <Status
      message={
        state.status === 'loading'
          ? `Cargando «${bundle.chart.title}»…`
          : `No se pudo cargar el audio: ${state.message}`
      }
      onBack={state.status === 'error' ? onDone : undefined}
    />
  )
}

type Step = 'tap' | 'preview'

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

function WizardLayout({
  session,
  songId,
  onDone,
}: {
  session: GameSession
  songId: string
  onDone: () => void
}) {
  const { chart } = session
  const kicks = useMemo(() => kickTimes(chart), [chart])
  const playing = useGameStore(selectPhase) === 'playing'
  const [step, setStep] = useState<Step>('tap')
  const [offsetMs, setOffsetMs] = useState(chart.youtubeOffsetMs)
  const [estimate, setEstimate] = useState<OffsetEstimate | null>(null)
  const [tapCount, setTapCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Toques como tiempo de video (s); durante el marcado el video va con offset 0
  const taps = useRef<number[]>([])

  const tapAt = useCallback(
    (songTimeS: number) => {
      if (!session.isPlaying) return
      taps.current.push(songTimeS)
      setTapCount(taps.current.length)
    },
    [session],
  )

  // Golpes del kit: su propio timestamp, sin la latencia calibrada del kit
  useEffect(() => {
    if (step !== 'tap') return
    return midiManager.onHit(hit => {
      const latencyS = useSettingsStore.getState().midiLatencyOffsetMs / 1000
      tapAt(session.clock.perfToSong(hit.timestamp) - latencyS)
    })
  }, [step, session, tapAt])

  // Teclado: Espacio marca; en el ajuste fino ←/→ mueven 5 ms
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.repeat) return
      if (step === 'tap' && e.code === 'Space') {
        e.preventDefault()
        tapAt(session.clock.perfToSong(e.timeStamp))
      } else if (step === 'preview' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        e.preventDefault()
        setOffsetMs(o => o + (e.code === 'ArrowLeft' ? -FINE_STEP_MS : FINE_STEP_MS))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, session, tapAt])

  function startTapping() {
    taps.current = []
    setTapCount(0)
    silence(session)
    session.seek(0)
    void session.play()
  }

  function toPreview(offset: number) {
    setOffsetMs(offset)
    setStep('preview')
    session.applyPreset('listen')
    session.seek(previewStartS(kicks))
    void session.play()
  }

  function finishTapping() {
    session.pause()
    const result = estimateOffset(taps.current, kicks)
    setEstimate(result)
    if (result) toPreview(result.offsetMs)
  }

  function backToTapping() {
    session.pause()
    setStep('tap')
    taps.current = []
    setTapCount(0)
    silence(session)
  }

  function replayPreview() {
    session.seek(previewStartS(kicks))
    void session.play()
  }

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      await useLibraryStore.getState().setYoutubeOffset(songId, offsetMs)
      session.pause()
      onDone()
    } catch (e) {
      setSaveError(
        `Se guardó en este equipo, pero no en la nube: ${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      setSaving(false)
    }
  }

  // Durante el marcado el video va con offset 0: el toque es directamente tiempo de video
  const videoOffset = step === 'tap' ? 0 : offsetMs
  const nudge = (delta: number) => setOffsetMs(o => o + delta)

  return (
    <main className="flex h-full flex-col gap-6 overflow-y-auto bg-bg p-10 font-sans text-fg select-none">
      <div className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <SectionLabel className="text-xs">Sincronizar video · {chart.title}</SectionLabel>
          <h1 className="text-[32px] font-extrabold tracking-[-0.02em]">
            {step === 'tap' ? '1. Marca los golpes de bombo' : '2. Ajusta y comprueba'}
          </h1>
        </div>
        <Button
          size="sm"
          onClick={() => {
            session.pause()
            onDone()
          }}
        >
          Cancelar
        </Button>
      </div>

      <div className="flex flex-wrap gap-6">
        <VideoPanel youtubeUrl={chart.youtubeUrl} offsetMs={videoOffset} clock={session.clock} />

        <Panel className="max-w-md min-w-80 flex-1 gap-4">
          {!chart.youtubeUrl ? (
            <p className="text-sm text-fg-2">Esta canción no tiene un video de YouTube enlazado.</p>
          ) : step === 'tap' ? (
            <>
              <p className="text-sm text-fg-2">
                El video empieza desde el principio, sin sonido. Toca cualquier pad (o la tecla{' '}
                <kbd className="font-mono">Espacio</kbd>) cada vez que <b>veas</b> un golpe de
                bombo, empezando por el <b>primero</b>. Con {MIN_TAPS}–8 toques basta.
              </p>
              <p className="font-mono text-sm text-accent" aria-live="polite">
                {tapCount} {tapCount === 1 ? 'toque' : 'toques'}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button variant="primary" onClick={startTapping}>
                  {playing || tapCount ? 'Empezar de nuevo' : 'Empezar'}
                </Button>
                <Button disabled={tapCount === 0} onClick={finishTapping}>
                  Calcular offset
                </Button>
              </div>
              {tapCount > 0 && tapCount < MIN_TAPS && (
                <p className="text-xs text-muted">
                  Con menos de {MIN_TAPS} toques el cálculo es menos fiable.
                </p>
              )}
              <div className="flex-1" />
              <button
                type="button"
                className="cursor-pointer self-start text-xs text-muted underline underline-offset-2"
                onClick={() => toPreview(offsetMs)}
              >
                Saltar al ajuste fino ({formatSignedMs(offsetMs)})
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-fg-2">
                Ahora suena la canción con el video. Si el video va adelantado, resta; si va
                atrasado, suma. También con <kbd className="font-mono">←</kbd>/
                <kbd className="font-mono">→</kbd> (±{FINE_STEP_MS} ms).
              </p>
              <p className="text-center font-mono text-[40px] font-bold text-accent">
                {formatSignedMs(offsetMs)}
              </p>
              {estimate && (
                <p className="text-center text-xs text-muted">
                  {estimate.used} toques usados
                  {estimate.discarded > 0 && `, ${estimate.discarded} descartados`} · dispersión ±
                  {estimate.spreadMs} ms
                </p>
              )}
              <div className="grid grid-cols-4 gap-2">
                <Button size="sm" onClick={() => nudge(-COARSE_STEP_MS)}>
                  −{COARSE_STEP_MS}
                </Button>
                <Button size="sm" onClick={() => nudge(-FINE_STEP_MS)}>
                  −{FINE_STEP_MS}
                </Button>
                <Button size="sm" onClick={() => nudge(FINE_STEP_MS)}>
                  +{FINE_STEP_MS}
                </Button>
                <Button size="sm" onClick={() => nudge(COARSE_STEP_MS)}>
                  +{COARSE_STEP_MS}
                </Button>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button onClick={playing ? () => session.pause() : replayPreview}>
                  {playing ? 'Pausar' : 'Ver desde el primer bombo'}
                </Button>
                <Button onClick={backToTapping}>Volver a marcar</Button>
              </div>
              <div className="flex-1" />
              {saveError && (
                <p role="alert" className="text-sm text-miss">
                  {saveError}
                </p>
              )}
              <Button variant="primary" size="lg" disabled={saving} onClick={() => void save()}>
                {saving ? 'Guardando…' : 'Guardar offset'}
              </Button>
            </>
          )}
        </Panel>
      </div>
    </main>
  )
}

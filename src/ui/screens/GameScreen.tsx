import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ChartSection, Difficulty } from '@/types'
import type { MixChannel } from '@/audio/Mixer'
import type { GameSession, SessionOptions, SongBundle } from '@/game/GameSession'
import { sessionSnapshot } from '@/game/lastSession'
import type { SongRef } from '@/game/lastSession'
import { sectionStartS } from '@/game/sections'
import type { PracticeSuggestion } from '@/game/sections'
import type { PracticeLoop } from '@/game/practice'
import { PRACTICE_LAYERS, filterLayer } from '@/chart/layers'
import type { PracticeLayer } from '@/chart/layers'
import { useGameSession } from '@/hooks/useGameSession'
import type { ScoreResults } from '@/scoring/ScoreManager'
import { EMPTY_SNAPSHOT, selectPhase, useGameStore } from '@/store/gameStore'
import { useSessionStore } from '@/store/sessionStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useHistoryStore } from '@/store/historyStore'
import { MIN_PLAY_S, playEntry } from '@/progress/history'
import type { PlayInput } from '@/progress/history'
import { GameHeader } from '@/ui/game/GameHeader'
import { ScorePanel } from '@/ui/game/ScorePanel'
import { SectionsPanel } from '@/ui/game/SectionsPanel'
import { SessionSettingsPanel } from '@/ui/game/SessionSettingsPanel'
import { TransportBar } from '@/ui/game/TransportBar'
import { VideoPanel } from '@/ui/game/VideoPanel'
import { Button } from '@/ui/primitives'

// Al arrastrar el tempo se espera a que el valor se asiente antes de estirar el audio
const TEMPO_DEBOUNCE_MS = 250

interface GameScreenProps {
  bundle: SongBundle
  /** De dónde recargar la canción en "Continuar"; null = no se guarda la sesión. */
  songRef: SongRef | null
  /** Segundo en el que empieza la partida (Continuar retoma la sección guardada). */
  startAtS?: number
  /** Abre con este loop y tempo (Resultados → "Practicar compases…"). */
  practice?: PracticeRequest | null
  onExit: () => void
  onFinished: (results: ScoreResults) => void
  onRecalibrate: () => void
}

/** Loop y tempo con que abrir la partida ("Practicar compases…" en Resultados). */
export interface PracticeRequest {
  loop: PracticeLoop
  tempo: number
}

function readOptions(): SessionOptions {
  const s = useSettingsStore.getState()
  return {
    countIn: s.countIn,
    tempoRamp: s.tempoRamp,
    waitMode: s.waitMode,
    layer: s.layer,
    difficulty: s.difficulty,
    level: s.level,
    latencyMs: s.midiLatencyOffsetMs,
    dynamicsBonus: s.dynamicsBonus,
    mix: s.mix,
  }
}

/** Pantalla de juego (PLAN_V2 §4.3). Abre la sesión y muestra carga o error. */
export function GameScreen({
  bundle,
  songRef,
  startAtS = 0,
  practice = null,
  onExit,
  onFinished,
  onRecalibrate,
}: GameScreenProps) {
  const state = useGameSession(bundle, readOptions)

  if (state.status === 'ready') {
    return (
      <GameLayout
        session={state.session}
        songRef={songRef}
        startAtS={startAtS}
        practiceRequest={practice}
        onExit={onExit}
        onFinished={onFinished}
        onRecalibrate={onRecalibrate}
      />
    )
  }
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 bg-bg font-sans text-fg">
      {state.status === 'loading' ? (
        <p className="text-sm text-muted">Cargando «{bundle.chart.title}»…</p>
      ) : (
        <>
          <p className="max-w-lg text-center text-sm text-fg-2">
            No se pudo cargar el audio: {state.message}
          </p>
          <Button onClick={onExit}>Volver</Button>
        </>
      )}
    </main>
  )
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

interface GameLayoutProps {
  session: GameSession
  songRef: SongRef | null
  startAtS: number
  practiceRequest: PracticeRequest | null
  onExit: () => void
  onFinished: (results: ScoreResults) => void
  onRecalibrate: () => void
}

function GameLayout({
  session,
  songRef,
  startAtS,
  practiceRequest,
  onExit,
  onFinished,
  onRecalibrate,
}: GameLayoutProps) {
  const { chart } = session
  const phase = useGameStore(selectPhase)
  const [difficulty, setDifficultyState] = useState<Difficulty>(session.difficulty)
  const setSavedDifficulty = useSettingsStore(s => s.setDifficulty)
  const [layer, setLayerState] = useState<PracticeLayer>(session.layer)
  const setSavedLayer = useSettingsStore(s => s.setLayer)
  const layerCounts = useMemo(() => {
    const notes = chart.difficulties[difficulty].notes
    return Object.fromEntries(
      PRACTICE_LAYERS.map(l => [l, filterLayer(notes, l).length]),
    ) as Record<PracticeLayer, number>
  }, [chart, difficulty])

  // Continuar: la partida empieza en la sección guardada, en pausa
  useEffect(() => {
    if (startAtS > 0) session.seek(startAtS)
  }, [session, startAtS])

  // Última sesión (portada → Continuar): al empezar, pausar, terminar, salir y recargar
  useEffect(() => {
    if (!songRef) return
    const save = () => {
      const ended = useGameStore.getState().phase === 'ended'
      useSessionStore.getState().save(
        sessionSnapshot({
          song: songRef,
          chart,
          sections: session.sections,
          positionS: ended ? null : session.clock.now(),
          difficulty: session.difficulty,
          tempo: session.tempo,
          now: Date.now(),
        }),
      )
    }
    save()
    const unsubscribe = useGameStore.subscribe((state, prev) => {
      if (state.phase !== prev.phase && state.phase !== 'idle') save()
    })
    window.addEventListener('pagehide', save)
    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', save)
      save()
    }
  }, [session, songRef, chart])

  // Historial (D7): la partida al terminar; al salir o recargar, lo tocado si fue un rato
  useEffect(() => {
    // Al salir, el dispose de la sesión puede vaciar el store antes: se guarda el último HUD
    let hud = useGameStore.getState().hud
    const record = (completed: boolean) => {
      const durationS = session.takePlayedSeconds(completed ? 0 : MIN_PLAY_S)
      if (!completed && durationS === 0) return
      const input: PlayInput = {
        songId: chart.id,
        title: chart.title,
        difficulty: session.difficulty,
        level: useSettingsStore.getState().level,
        tempo: session.tempo,
        layer: session.layer,
        waitMode: session.practice.waitMode,
        completed,
        score: hud.score,
        precision: hud.precision,
        counts: hud.counts,
        durationS,
      }
      useHistoryStore.getState().addPlay(playEntry(input, crypto.randomUUID(), Date.now()))
    }
    const unsubscribe = useGameStore.subscribe((state, prev) => {
      if (state.hud !== EMPTY_SNAPSHOT) hud = state.hud
      if (state.phase === 'ended' && prev.phase !== 'ended') record(true)
    })
    const onHide = () => record(false)
    window.addEventListener('pagehide', onHide)
    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', onHide)
      record(false)
    }
  }, [session, chart])
  const playing = phase === 'playing'
  const [videoVisible, setVideoVisible] = useState(true)

  const view = useSettingsStore(s => s.view)
  const setView = useSettingsStore(s => s.setView)
  const level = useSettingsStore(s => s.level)
  const scrollSpeed = useSettingsStore(s => s.scrollSpeed)
  const mix = useSettingsStore(s => s.mix)
  const setMixLevel = useSettingsStore(s => s.setMixLevel)
  const latencyMs = useSettingsStore(s => s.midiLatencyOffsetMs)
  const dynamicsBonus = useSettingsStore(s => s.dynamicsBonus)
  const setDynamicsBonus = useSettingsStore(s => s.setDynamicsBonus)

  const toggle = useCallback(() => void session.toggle(), [session])
  const seek = useCallback((t: number) => session.seek(t), [session])
  const seekSection = useCallback(
    (section: ChartSection) => session.seek(sectionStartS(chart.grid, section)),
    [session, chart.grid],
  )

  const changeMix = (channel: MixChannel, value: number) => {
    setMixLevel(channel, value)
    session.setMixLevel(channel, value)
  }
  const changeLayer = (value: PracticeLayer) => {
    session.setLayer(value)
    setLayerState(value)
    setSavedLayer(value)
  }
  const changeDifficulty = (value: Difficulty) => {
    session.setDifficulty(value)
    setDifficultyState(value)
    setSavedDifficulty(value)
  }
  // Tempo, loop, cuenta y rampa (D2–D3): el estado vive en la sesión (la rampa
  // cambia el tempo sola); aquí solo el valor del deslizador mientras se arrastra
  const practice = useSyncExternalStore(session.subscribePractice, () => session.practice)
  const [tempoDraft, setTempoDraft] = useState<number | null>(null)
  const setSavedTempo = useSettingsStore(s => s.setTempo)
  const setSavedCountIn = useSettingsStore(s => s.setCountIn)
  const setSavedRamp = useSettingsStore(s => s.setTempoRamp)
  const setSavedWaitMode = useSettingsStore(s => s.setWaitMode)
  const tempoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // El error ya queda en practice.tempoError
  const runTempo = useCallback(
    (value: number) => {
      session.setTempo(value).catch(() => {})
    },
    [session],
  )
  // Al abrir: el loop de práctica pedido (Resultados) o el último tempo elegido
  useEffect(() => {
    if (practiceRequest) {
      session.setLoop(practiceRequest.loop)
      runTempo(practiceRequest.tempo)
      return
    }
    const saved = useSettingsStore.getState().tempo
    if (saved !== session.tempo) runTempo(saved)
  }, [session, runTempo, practiceRequest])
  useEffect(
    () => () => {
      if (tempoTimer.current) clearTimeout(tempoTimer.current)
    },
    [],
  )
  const changeTempo = (value: number) => {
    setTempoDraft(value)
    setSavedTempo(value)
    if (tempoTimer.current) clearTimeout(tempoTimer.current)
    tempoTimer.current = setTimeout(() => {
      setTempoDraft(null)
      runTempo(value)
    }, TEMPO_DEBOUNCE_MS)
  }
  const tempo = tempoDraft ?? practice.tempo
  const changeCountIn = (on: boolean) => {
    setSavedCountIn(on)
    session.setCountIn(on)
  }
  const changeRamp = (on: boolean) => {
    setSavedRamp(on)
    session.setTempoRamp(on)
  }
  const changeWaitMode = (on: boolean) => {
    setSavedWaitMode(on)
    session.setWaitMode(on)
  }
  const changeLoop = useCallback((loop: PracticeLoop | null) => session.setLoop(loop), [session])
  const practiceSuggestion = useCallback(
    (suggestion: PracticeSuggestion) => {
      session.setLoop({ startMeasure: suggestion.startMeasure, endMeasure: suggestion.endMeasure })
      setSavedTempo(suggestion.tempo)
      runTempo(suggestion.tempo)
    },
    [session, runTempo, setSavedTempo],
  )

  const changeDynamics = (on: boolean) => {
    setDynamicsBonus(on)
    session.setDynamicsBonus(on)
  }

  // Espacio = play/pausa; V = mostrar/ocultar video; Esc = salir a la lista
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      if (e.code === 'Space') {
        e.preventDefault() // ni scroll ni "clic" en el botón con foco
        void session.toggle()
      } else if (e.code === 'KeyV') {
        setVideoVisible(v => !v)
      } else if (e.code === 'Escape') {
        onExit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [session, onExit])

  useEffect(() => {
    if (phase !== 'ended') return
    const { results } = useGameStore.getState()
    if (results) onFinished(results)
  }, [phase, onFinished])

  return (
    <main className="flex h-full flex-col overflow-hidden bg-bg font-sans text-fg">
      <GameHeader
        chart={chart}
        difficulty={difficulty}
        tempo={tempo}
        layer={layer}
        clock={session.clock}
        playing={playing}
        onToggle={toggle}
      />
      <ScorePanel
        source={session.engine}
        clock={session.clock}
        notes={session.engine.chartNotes}
        grid={chart.grid}
        view={view}
        onViewChange={setView}
        level={level}
        scrollSpeed={scrollSpeed}
      />
      <div className="mx-6 mt-4 mb-6 flex min-h-0 flex-1 gap-6">
        <div className="flex min-w-0 shrink grow-0 basis-[1028px] flex-col gap-4">
          <div className="flex h-[360px] shrink-0 gap-6">
            {videoVisible && (
              <VideoPanel
                youtubeUrl={chart.youtubeUrl}
                offsetMs={chart.youtubeOffsetMs}
                clock={session.clock}
                onHide={() => setVideoVisible(false)}
              />
            )}
            <SectionsPanel
              sections={session.sections}
              grid={chart.grid}
              clock={session.clock}
              onSeekSection={seekSection}
              onPractice={practiceSuggestion}
              onShowVideo={videoVisible ? undefined : () => setVideoVisible(true)}
            />
          </div>
          <TransportBar
            clock={session.clock}
            durationS={session.durationS}
            fileName={session.fileName}
            playing={playing}
            peaks={session.peaks}
            sections={session.sections}
            autoSections={chart.sections.length === 0}
            grid={chart.grid}
            onToggle={toggle}
            onSeek={seek}
            loop={practice.loop}
            onLoopChange={changeLoop}
            tempo={tempo}
            countIn={practice.countIn}
            onCountInChange={changeCountIn}
          />
        </div>
        <SessionSettingsPanel
          difficulty={difficulty}
          difficultyCounts={{
            basic: chart.difficulties.basic.notes.length,
            intermediate: chart.difficulties.intermediate.notes.length,
            full: chart.difficulties.full.notes.length,
          }}
          onDifficultyChange={changeDifficulty}
          layer={layer}
          layerCounts={layerCounts}
          onLayerChange={changeLayer}
          tempo={tempo}
          tempoPending={tempoDraft !== null || practice.tempoPending}
          tempoError={practice.tempoError}
          onTempoChange={changeTempo}
          tempoRamp={practice.tempoRamp}
          onTempoRampChange={changeRamp}
          loop={practice.loop}
          lastLap={practice.lastLap}
          waitMode={practice.waitMode}
          onWaitModeChange={changeWaitMode}
          waitingFor={practice.waitingFor}
          mix={mix}
          audioMode={session.audioMode}
          onMixChange={changeMix}
          videoOffsetMs={chart.youtubeOffsetMs}
          latencyMs={latencyMs}
          onRecalibrate={() => {
            session.pause()
            onRecalibrate()
          }}
          dynamicsBonus={dynamicsBonus}
          onDynamicsBonusChange={changeDynamics}
        />
      </div>
    </main>
  )
}

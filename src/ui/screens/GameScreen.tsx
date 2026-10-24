import { useCallback, useEffect, useState } from 'react'
import type { ChartSection, Difficulty } from '@/types'
import type { MixChannel } from '@/audio/Mixer'
import type { GameSession, SessionOptions, SongBundle } from '@/game/GameSession'
import { sectionStartS } from '@/game/sections'
import { useGameSession } from '@/hooks/useGameSession'
import type { ScoreResults } from '@/scoring/ScoreManager'
import { selectPhase, useGameStore } from '@/store/gameStore'
import { useSettingsStore } from '@/store/settingsStore'
import { GameHeader } from '@/ui/game/GameHeader'
import { ScorePanel } from '@/ui/game/ScorePanel'
import { SectionsPanel } from '@/ui/game/SectionsPanel'
import { SessionSettingsPanel } from '@/ui/game/SessionSettingsPanel'
import { TransportBar } from '@/ui/game/TransportBar'
import { VideoPanel } from '@/ui/game/VideoPanel'
import { Button } from '@/ui/primitives'

// Básico e Intermedio llegan con el reductor de dificultad (Fase D)
const DIFFICULTY: Difficulty = 'full'

interface GameScreenProps {
  bundle: SongBundle
  onExit: () => void
  onFinished: (results: ScoreResults) => void
  onRecalibrate: () => void
}

function readOptions(): SessionOptions {
  const s = useSettingsStore.getState()
  return {
    difficulty: DIFFICULTY,
    level: s.level,
    latencyMs: s.midiLatencyOffsetMs,
    dynamicsBonus: s.dynamicsBonus,
    mix: s.mix,
  }
}

/** Pantalla de juego (PLAN_V2 §4.3). Abre la sesión y muestra carga o error. */
export function GameScreen({ bundle, onExit, onFinished, onRecalibrate }: GameScreenProps) {
  const state = useGameSession(bundle, readOptions)

  if (state.status === 'ready') {
    return (
      <GameLayout
        session={state.session}
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
  onExit: () => void
  onFinished: (results: ScoreResults) => void
  onRecalibrate: () => void
}

function GameLayout({ session, onExit, onFinished, onRecalibrate }: GameLayoutProps) {
  const { chart } = session
  const phase = useGameStore(selectPhase)
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
        difficulty={DIFFICULTY}
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
              <VideoPanel youtubeUrl={chart.youtubeUrl} onHide={() => setVideoVisible(false)} />
            )}
            <SectionsPanel
              sections={session.sections}
              grid={chart.grid}
              clock={session.clock}
              onSeekSection={seekSection}
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
          />
        </div>
        <SessionSettingsPanel
          difficulty={DIFFICULTY}
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

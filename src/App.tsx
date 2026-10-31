import { useCallback, useEffect, useState } from 'react'
import type { SongBundle } from '@/game/GameSession'
import { resumePositionS } from '@/game/lastSession'
import type { SongRef } from '@/game/lastSession'
import { effectiveSections } from '@/game/sections'
import { useMidi } from '@/hooks/useMidi'
import { syncMidiMapWithSettings } from '@/midi/syncMidiMap'
import { builtinBundle } from '@/songs/songBundle'
import { loadChart } from '@/songs/songLoader'
import type { ScoreResults } from '@/scoring/ScoreManager'
import { BrowserWarning } from '@/ui/components/BrowserWarning'
import { MidiConnectionToast } from '@/ui/components/MidiConnectionToast'
import { CalibrationScreen } from '@/ui/screens/CalibrationScreen'
import { GameScreen } from '@/ui/screens/GameScreen'
import { HomeScreen } from '@/ui/screens/HomeScreen'
import { ResultsScreen } from '@/ui/screens/ResultsScreen'
import { SettingsScreen } from '@/ui/screens/SettingsScreen'
import { useAuthStore } from '@/store/authStore'
import { useLibraryStore } from '@/store/libraryStore'
import { useSessionStore } from '@/store/sessionStore'
import { syncAccentWithSettings } from '@/store/settingsStore'
import { ImportScreen } from '@/ui/screens/ImportScreen'
import { LibraryScreen } from '@/ui/screens/LibraryScreen'

type Screen = 'home' | 'library' | 'import' | 'game' | 'results' | 'settings' | 'calibration'

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [bundle, setBundle] = useState<SongBundle | null>(null)
  const [songRef, setSongRef] = useState<SongRef | null>(null)
  const [startAtS, setStartAtS] = useState(0)
  const [results, setResults] = useState<ScoreResults | null>(null)
  const [playedAt, setPlayedAt] = useState(0)
  // A dónde vuelve Ajustes
  const [settingsReturn, setSettingsReturn] = useState<Screen>('home')
  // Recalibrar desde la partida vuelve a la partida; desde Ajustes, a Ajustes
  const [calibrationReturn, setCalibrationReturn] = useState<Screen>('settings')
  // Importar puede abrirse con el progreso de un análisis en curso
  const [importSongId, setImportSongId] = useState<string | null>(null)
  const { connect } = useMidi()

  // Auto-conectar MIDI al montar (solo si el browser lo soporta)
  useEffect(() => {
    if ('requestMIDIAccess' in navigator) {
      void connect()
    }
  }, [connect])

  // El mapa guardado (calibración) es el que usa el midiManager
  useEffect(() => syncMidiMapWithSettings(), [])

  // Color de acento elegido en Ajustes
  useEffect(() => syncAccentWithSettings(), [])

  // Modo nube: sesión (anónima o con correo) y biblioteca de la cuenta
  useEffect(() => {
    void useAuthStore.getState().init()
  }, [])

  const openSettings = (from: Screen) => {
    setSettingsReturn(from)
    setScreen('settings')
  }

  const openCalibration = (from: Screen) => {
    setCalibrationReturn(from)
    setScreen('calibration')
  }

  const openImport = (songId: string | null = null) => {
    setImportSongId(songId)
    setScreen('import')
  }

  const play = (b: SongBundle, ref: SongRef | null, startAt = 0) => {
    if (ref?.kind === 'library') void useLibraryStore.getState().markPlayed(ref.id)
    setBundle(b)
    setSongRef(ref)
    setStartAtS(startAt)
    setScreen('game')
  }

  /** Portada → Continuar: recarga la canción y retoma la sección guardada. */
  const resume = async () => {
    const last = useSessionStore.getState().last
    if (!last) return
    try {
      const b =
        last.song.kind === 'builtin'
          ? builtinBundle(await loadChart(last.song.id))
          : await useLibraryStore.getState().bundle(last.song.id)
      play(b, last.song, resumePositionS(last, b.chart.grid, effectiveSections(b.chart)))
    } catch (e) {
      // La canción ya no está (borrada o sin red): se olvida y se elige otra
      useSessionStore.getState().forget(last.song)
      throw e
    }
  }

  const handleFinished = useCallback((r: ScoreResults) => {
    setResults(r)
    setPlayedAt(Date.now())
    setScreen('results')
  }, [])

  return (
    <div className="h-screen w-screen">
      <BrowserWarning />
      <MidiConnectionToast />

      {screen === 'home' && (
        <HomeScreen
          onContinue={resume}
          onPlay={() => setScreen('library')}
          onImport={() => openImport()}
          onSettings={() => openSettings('home')}
        />
      )}

      {screen === 'library' && (
        <LibraryScreen
          onSongReady={play}
          onImport={() => openImport()}
          onOpenImport={openImport}
          onBack={() => setScreen('home')}
        />
      )}

      {screen === 'import' && (
        <ImportScreen
          initialSongId={importSongId}
          onPlay={(b, id) => play(b, { kind: 'library', id })}
          onBack={() => setScreen('library')}
        />
      )}

      {screen === 'game' && bundle && (
        <GameScreen
          bundle={bundle}
          songRef={songRef}
          startAtS={startAtS}
          onExit={() => setScreen('library')}
          onFinished={handleFinished}
          onRecalibrate={() => openCalibration('game')}
        />
      )}

      {screen === 'results' && bundle && results && (
        <ResultsScreen
          chart={bundle.chart}
          results={results}
          playedAt={playedAt}
          onRetry={() => {
            setStartAtS(0)
            setScreen('game')
          }}
          onMenu={() => setScreen('library')}
        />
      )}

      {screen === 'settings' && (
        <SettingsScreen
          onBack={() => setScreen(settingsReturn)}
          onCalibrate={() => openCalibration('settings')}
        />
      )}

      {screen === 'calibration' && (
        <CalibrationScreen onBack={() => setScreen(calibrationReturn)} />
      )}
    </div>
  )
}

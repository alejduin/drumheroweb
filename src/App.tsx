import { useCallback, useEffect, useState } from 'react'
import type { SongBundle } from '@/game/GameSession'
import { useMidi } from '@/hooks/useMidi'
import { syncMidiMapWithSettings } from '@/midi/syncMidiMap'
import type { ScoreResults } from '@/scoring/ScoreManager'
import { BrowserWarning } from '@/ui/components/BrowserWarning'
import { MidiConnectionToast } from '@/ui/components/MidiConnectionToast'
import { CalibrationScreen } from '@/ui/screens/CalibrationScreen'
import { GameScreen } from '@/ui/screens/GameScreen'
import { HomeScreen } from '@/ui/screens/HomeScreen'
import { ResultsScreen } from '@/ui/screens/ResultsScreen'
import { SettingsScreen } from '@/ui/screens/SettingsScreen'
import { SongSelectScreen } from '@/ui/screens/SongSelectScreen'

type Screen = 'home' | 'song-select' | 'game' | 'results' | 'settings' | 'calibration'

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [bundle, setBundle] = useState<SongBundle | null>(null)
  const [results, setResults] = useState<ScoreResults | null>(null)
  // A dónde vuelve Ajustes
  const [settingsReturn, setSettingsReturn] = useState<Screen>('home')
  // Recalibrar desde la partida vuelve a la partida; desde Ajustes, a Ajustes
  const [calibrationReturn, setCalibrationReturn] = useState<Screen>('settings')
  const { connect } = useMidi()

  // Auto-conectar MIDI al montar (solo si el browser lo soporta)
  useEffect(() => {
    if ('requestMIDIAccess' in navigator) {
      void connect()
    }
  }, [connect])

  // El mapa guardado (calibración) es el que usa el midiManager
  useEffect(() => syncMidiMapWithSettings(), [])

  const openSettings = (from: Screen) => {
    setSettingsReturn(from)
    setScreen('settings')
  }

  const openCalibration = (from: Screen) => {
    setCalibrationReturn(from)
    setScreen('calibration')
  }

  const handleFinished = useCallback((r: ScoreResults) => {
    setResults(r)
    setScreen('results')
  }, [])

  return (
    <div className="h-screen w-screen">
      <BrowserWarning />
      <MidiConnectionToast />

      {screen === 'home' && (
        <HomeScreen
          onPlay={() => setScreen('song-select')}
          onSettings={() => openSettings('home')}
        />
      )}

      {screen === 'song-select' && (
        <SongSelectScreen
          onSongReady={b => {
            setBundle(b)
            setScreen('game')
          }}
          onBack={() => setScreen('home')}
        />
      )}

      {screen === 'game' && bundle && (
        <GameScreen
          bundle={bundle}
          onExit={() => setScreen('song-select')}
          onFinished={handleFinished}
          onRecalibrate={() => openCalibration('game')}
        />
      )}

      {screen === 'results' && bundle && results && (
        <ResultsScreen
          chart={bundle.chart}
          results={results}
          onRetry={() => setScreen('game')}
          onMenu={() => setScreen('song-select')}
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

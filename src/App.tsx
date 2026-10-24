import { useEffect, useState } from 'react'
import { BrowserWarning } from '@/ui/components/BrowserWarning'
import { MidiConnectionToast } from '@/ui/components/MidiConnectionToast'
import { useMidi } from '@/hooks/useMidi'
import { useGameStore } from '@/store/gameStore'
import { GameScreen } from '@/ui/screens/GameScreen'
import { HomeScreen } from '@/ui/screens/HomeScreen'
import { ResultsScreen } from '@/ui/screens/ResultsScreen'
import { SettingsScreen } from '@/ui/screens/SettingsScreen'
import { SongSelectScreen } from '@/ui/screens/SongSelectScreen'
import type { SongData } from '@/types'

type Screen = 'home' | 'song-select' | 'game' | 'settings'

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [selectedSong, setSelectedSong] = useState<SongData | null>(null)
  const { connect } = useMidi()

  // Auto-conectar MIDI al montar (solo si el browser lo soporta)
  useEffect(() => {
    if ('requestMIDIAccess' in navigator) {
      connect()
    }
  }, [connect])

  // El engine emite 'results' cuando termina la canción
  const gamePhase = useGameStore(s => s.phase)

  function handleSongReady(song: SongData) {
    setSelectedSong(song)
    setScreen('game')
  }

  function handlePlayAgain() {
    setScreen('game')
  }

  function handleBackToMenu() {
    setSelectedSong(null)
    setScreen('home')
  }

  // Pantalla de resultados cuando el engine termina
  if (gamePhase === 'results' && selectedSong) {
    return (
      <div className="w-screen h-screen">
        <ResultsScreen
          song={selectedSong}
          onPlayAgain={handlePlayAgain}
          onMenu={handleBackToMenu}
        />
      </div>
    )
  }

  return (
    <div className="w-screen h-screen">
      <BrowserWarning />
      <MidiConnectionToast />

      {screen === 'home' && (
        <HomeScreen
          onPlay={() => setScreen('song-select')}
          onSettings={() => setScreen('settings')}
        />
      )}

      {screen === 'song-select' && (
        <SongSelectScreen
          onSongReady={handleSongReady}
          onBack={() => setScreen('home')}
        />
      )}

      {screen === 'game' && selectedSong && (
        <GameScreen
          song={selectedSong}
          onStop={handleBackToMenu}
        />
      )}

      {screen === 'settings' && (
        <SettingsScreen onBack={() => setScreen('home')} />
      )}
    </div>
  )
}

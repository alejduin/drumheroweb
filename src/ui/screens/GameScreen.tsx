import { useEffect } from 'react'
import { GameCanvas } from '@/renderer/GameCanvas'
import { useGameEngine } from '@/hooks/useGameEngine'
import { useGameStore } from '@/store/gameStore'
import type { SongData } from '@/types'

interface GameScreenProps {
  song: SongData
  onStop: () => void
}

/**
 * GameScreen — monta el canvas y los controles de pausa/salida.
 *
 * Solo suscribe a `phase` del gameStore. Score, combo y HUD se leen
 * imperativamente dentro del RAF loop de GameCanvas, evitando re-renders
 * de React en cada golpe durante el juego.
 */
export function GameScreen({ song, onStop }: GameScreenProps) {
  const { phase, scrollSpeed, load, start, pause, resume, stop } = useGameEngine()

  // Solo suscribirse a phase — no a score/combo (eso lo lee el canvas directo)
  const gamePhase = useGameStore(s => s.phase)

  useEffect(() => {
    load(song)
  }, [song, load])

  useEffect(() => {
    if (phase === 'idle') {
      start(song.bpm)
    }
  }, [phase, song.bpm, start])

  function handlePauseResume() {
    if (gamePhase === 'playing') pause()
    else if (gamePhase === 'paused') resume(song.bpm)
  }

  function handleStop() {
    stop()
    onStop()
  }

  return (
    <div className="flex flex-col h-full bg-black select-none">
      {/* Barra superior */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-950 border-b border-gray-800 shrink-0">
        <div className="text-white font-semibold truncate max-w-xs">
          {song.title}
          <span className="ml-2 text-gray-500 text-sm font-normal">{song.bpm} BPM</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handlePauseResume}
            className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors"
          >
            {gamePhase === 'paused' ? 'Reanudar' : 'Pausar'}
          </button>
          <button
            onClick={handleStop}
            className="px-4 py-1.5 bg-red-900 hover:bg-red-800 text-white rounded-lg text-sm transition-colors"
          >
            Salir
          </button>
        </div>
      </div>

      {/* Canvas ocupa el resto */}
      <div className="flex-1 relative overflow-hidden">
        {gamePhase === 'paused' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70">
            <div className="text-center">
              <div className="text-white text-4xl font-black mb-4">PAUSA</div>
              <button
                onClick={handlePauseResume}
                className="px-8 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-lg"
              >
                Continuar
              </button>
            </div>
          </div>
        )}
        <GameCanvas song={song} scrollSpeed={scrollSpeed} />
      </div>
    </div>
  )
}

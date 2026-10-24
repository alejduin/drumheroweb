import { useEffect } from 'react'
import { getStars } from '@/constants/game'
import { useGameStore } from '@/store/legacy/gameStoreV1'
import { useProgressStore } from '@/store/progressStore'
import type { SongData } from '@/types'

interface ResultsScreenProps {
  song: SongData
  onPlayAgain: () => void
  onMenu: () => void
}

export function ResultsScreen({ song, onPlayAgain, onMenu }: ResultsScreenProps) {
  const { score, accuracy } = useGameStore()
  const saveSongScore = useProgressStore(s => s.saveSongScore)

  const total = Object.values(accuracy).reduce((a, b) => a + b, 0)
  const hits = total - accuracy.miss
  const hitRatio = total > 0 ? hits / total : 0
  const stars = getStars(hitRatio)
  const pct = total > 0 ? Math.round((hits / total) * 100) : 0

  // Guardar score al montar
  useEffect(() => {
    saveSongScore(song.id, score, accuracy)
  }, [song.id, score, accuracy, saveSongScore])

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 bg-gray-950 text-white select-none px-6">
      {/* Título */}
      <div className="text-center">
        <div className="text-gray-400 text-sm uppercase tracking-widest mb-1">Resultado</div>
        <h2 className="text-3xl font-bold">{song.title}</h2>
      </div>

      {/* Estrellas */}
      <div className="text-5xl tracking-wider">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={i < stars ? 'text-yellow-400' : 'text-gray-700'}>
            ★
          </span>
        ))}
      </div>

      {/* Score */}
      <div className="text-center">
        <div className="text-6xl font-black text-white tabular-nums">{score.toLocaleString()}</div>
        <div className="text-gray-400 text-sm mt-1">PUNTUACIÓN</div>
      </div>

      {/* Desglose de precisión */}
      <div className="w-full max-w-sm grid grid-cols-4 gap-2 text-center">
        <AccuracyCell label="PERFECT" count={accuracy.perfect} color="text-yellow-400" />
        <AccuracyCell label="GREAT" count={accuracy.great} color="text-green-400" />
        <AccuracyCell label="GOOD" count={accuracy.good} color="text-yellow-300" />
        <AccuracyCell label="MISS" count={accuracy.miss} color="text-red-400" />
      </div>

      {/* Ratio de aciertos */}
      <div className="text-gray-300 text-lg">
        {hits} / {total} notas · <span className="font-bold text-white">{pct}%</span>
      </div>

      {/* Botones */}
      <div className="flex gap-4">
        <button
          onClick={onPlayAgain}
          className="px-8 py-3 bg-purple-600 hover:bg-purple-500 rounded-xl font-bold text-lg transition-colors"
        >
          Repetir
        </button>
        <button
          onClick={onMenu}
          className="px-8 py-3 bg-gray-800 hover:bg-gray-700 rounded-xl font-bold text-lg transition-colors"
        >
          Menú
        </button>
      </div>
    </div>
  )
}

function AccuracyCell({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="bg-gray-900 rounded-lg p-3">
      <div className={`text-xl font-bold ${color}`}>{count}</div>
      <div className="text-gray-500 text-xs mt-0.5">{label}</div>
    </div>
  )
}

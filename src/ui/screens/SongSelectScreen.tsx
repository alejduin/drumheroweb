import { useState } from 'react'
import { loadSong } from '@/songs/songLoader'
import { SONG_LIBRARY } from '@/songs/songLibrary'
import type { SongMeta } from '@/songs/songLibrary'
import { useProgressStore } from '@/store/progressStore'
import type { SongData } from '@/types'

const DIFFICULTY_LABEL: Record<SongMeta['difficulty'], string> = {
  beginner: 'Principiante',
  intermediate: 'Intermedio',
  advanced: 'Avanzado',
}

const DIFFICULTY_COLOR: Record<SongMeta['difficulty'], string> = {
  beginner: 'text-green-400',
  intermediate: 'text-yellow-400',
  advanced: 'text-red-400',
}

interface SongSelectScreenProps {
  onSongReady: (song: SongData) => void
  onBack: () => void
}

export function SongSelectScreen({ onSongReady, onBack }: SongSelectScreenProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const getBestScore = useProgressStore(s => s.getBestScore)

  async function handleSelect(meta: SongMeta) {
    setLoading(meta.id)
    setError(null)
    try {
      const song = await loadSong(meta.id)
      onSongReady(song)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar la canción')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white select-none">
      {/* Header */}
      <div className="flex items-center gap-4 p-6 border-b border-gray-800">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-white transition-colors text-sm"
        >
          ← Volver
        </button>
        <h2 className="text-2xl font-bold">Seleccionar canción</h2>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-3">
        {error && (
          <div className="p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        {SONG_LIBRARY.map(meta => {
          const best = getBestScore(meta.id)
          const isLoading = loading === meta.id

          return (
            <button
              key={meta.id}
              onClick={() => handleSelect(meta)}
              disabled={isLoading}
              className="flex items-center justify-between p-5 bg-gray-900 hover:bg-gray-800 active:bg-gray-700 rounded-xl transition-colors text-left disabled:opacity-50"
            >
              <div>
                <div className="font-bold text-lg">{meta.title}</div>
                <div className="text-sm text-gray-400 mt-0.5">
                  {meta.artist} · {meta.bpm} BPM
                </div>
                <div className={`text-xs mt-1 font-medium ${DIFFICULTY_COLOR[meta.difficulty]}`}>
                  {DIFFICULTY_LABEL[meta.difficulty]}
                </div>
              </div>

              <div className="flex flex-col items-end gap-1 min-w-[80px]">
                {isLoading ? (
                  <span className="text-purple-400 text-sm">Cargando...</span>
                ) : best ? (
                  <>
                    <span className="text-yellow-400 font-bold">
                      {'★'.repeat(best.stars)}
                      {'☆'.repeat(5 - best.stars)}
                    </span>
                    <span className="text-gray-300 text-sm font-mono">
                      {best.score.toLocaleString()}
                    </span>
                  </>
                ) : (
                  <span className="text-gray-600 text-sm">Sin jugar</span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

import { useCallback } from 'react'
import { metronome } from '@/engine/Metronome'
import { useGameStore } from '@/store/legacy/gameStoreV1'
import { useSettingsStore } from '@/store/settingsStore'
import type { SongData } from '@/types'

/**
 * Hook que expone las acciones del juego con la configuración del usuario aplicada.
 * Coordina gameStore, settingsStore y el metronome.
 */
export function useGameEngine() {
  const { phase, loadSong, startGame, pauseGame, resumeGame, stopGame } = useGameStore()
  const { midiLatencyOffsetMs, scrollSpeed, metronomeVolume } = useSettingsStore()

  const load = useCallback(
    (song: SongData) => {
      loadSong(song, midiLatencyOffsetMs)
    },
    [loadSong, midiLatencyOffsetMs],
  )

  const start = useCallback(
    async (bpm: number) => {
      startGame()
      if (metronomeVolume > 0) {
        await metronome.start(bpm, metronomeVolume)
      }
    },
    [startGame, metronomeVolume],
  )

  const pause = useCallback(() => {
    pauseGame()
    metronome.stop()
  }, [pauseGame])

  const resume = useCallback(
    async (bpm: number) => {
      resumeGame()
      if (metronomeVolume > 0) {
        await metronome.start(bpm, metronomeVolume)
      }
    },
    [resumeGame, metronomeVolume],
  )

  const stop = useCallback(() => {
    stopGame()
    metronome.stop()
  }, [stopGame])

  return { phase, scrollSpeed, load, start, pause, resume, stop }
}

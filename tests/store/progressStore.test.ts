import { beforeEach, describe, expect, it } from 'vitest'
import { applyPlay, migrateProgress, useProgressStore } from '@/store/progressStore'
import type { PlayRecord } from '@/store/progressStore'

const play = (score: number, precision: number | null, playedAt: number): PlayRecord => ({
  score,
  precision,
  playedAt,
  sections: [{ name: 'Verso', startMeasure: 1, precision }],
})

describe('applyPlay', () => {
  it('la primera partida es la mejor y la última', () => {
    const p = applyPlay(undefined, 'song', play(1000, 0.8, 1))
    expect(p).toEqual({
      songId: 'song',
      best: { score: 1000, precision: 0.8, stars: 3, playedAt: 1 },
      last: play(1000, 0.8, 1),
      plays: 1,
    })
  })

  it('la mejor solo cambia si se supera; la última siempre', () => {
    const first = applyPlay(undefined, 'song', play(1000, 0.8, 1))
    const worse = applyPlay(first, 'song', play(500, 0.6, 2))
    expect(worse.best).toBe(first.best)
    expect(worse.last?.playedAt).toBe(2)
    expect(worse.plays).toBe(2)

    const better = applyPlay(worse, 'song', play(2000, 0.95, 3))
    expect(better.best).toMatchObject({ score: 2000, precision: 0.95, stars: 4, playedAt: 3 })
  })

  it('guardar la misma partida dos veces no la duplica', () => {
    const first = applyPlay(undefined, 'song', play(1000, 0.8, 1))
    expect(applyPlay(first, 'song', play(1000, 0.8, 1))).toBe(first)
  })
})

describe('migrateProgress', () => {
  it('v1 → v2: las mejores puntuaciones se conservan, sin última partida', () => {
    const v1 = {
      bestScores: {
        a: { songId: 'a', score: 900, precision: 0.7, stars: 2, playedAt: 5 },
      },
    }
    expect(migrateProgress(v1, 1)).toEqual({
      songs: {
        a: {
          songId: 'a',
          best: { score: 900, precision: 0.7, stars: 2, playedAt: 5 },
          last: null,
          plays: 1,
        },
      },
    })
  })

  it('v0 (V1 del juego) se descarta', () => {
    expect(migrateProgress({ bestScores: { a: {} } }, 0)).toEqual({ songs: {} })
  })
})

describe('useProgressStore', () => {
  beforeEach(() => useProgressStore.getState().clearAll())

  it('recordPlay guarda por canción', () => {
    const { recordPlay } = useProgressStore.getState()
    recordPlay('a', play(1000, 0.8, 1))
    recordPlay('a', play(1000, 0.8, 1)) // StrictMode: el efecto corre dos veces
    recordPlay('b', play(10, 0.1, 2))
    const { songs } = useProgressStore.getState()
    expect(songs.a.plays).toBe(1)
    expect(songs.b.best.score).toBe(10)
  })
})

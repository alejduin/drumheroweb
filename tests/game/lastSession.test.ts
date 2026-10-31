import { describe, expect, it } from 'vitest'
import type { ChartSection } from '@/types'
import { resumePositionS, sameSong, sessionSnapshot, sessionSummary } from '@/game/lastSession'
import type { SessionSnapshotInput } from '@/game/lastSession'

// 120 BPM en 4/4: el compás n empieza en (n − 1) × 2 s; 16 compases
const GRID = {
  beats: Array.from({ length: 64 }, (_, i) => i * 0.5),
  downbeats: Array.from({ length: 16 }, (_, i) => i * 2),
}
const SECTIONS: ChartSection[] = [
  { name: 'Intro', startMeasure: 1, endMeasure: 4 },
  { name: 'Coro 1', startMeasure: 5, endMeasure: 12 },
]
const CHART = { title: 'Canción', artist: 'Banda', grid: GRID }

const input = (positionS: number | null): SessionSnapshotInput => ({
  song: { kind: 'library', id: 'abc' },
  chart: CHART,
  sections: SECTIONS,
  positionS,
  difficulty: 'full',
  tempo: 1,
  now: 42,
})

describe('sessionSnapshot', () => {
  it('guarda la sección que contiene la posición', () => {
    expect(sessionSnapshot(input(13.4))).toEqual({
      song: { kind: 'library', id: 'abc' },
      title: 'Canción',
      artist: 'Banda',
      section: { name: 'Coro 1', startMeasure: 5 },
      difficulty: 'full',
      tempo: 1,
      updatedAt: 42,
    })
  })

  it('partida terminada o fuera de las secciones = desde el principio', () => {
    expect(sessionSnapshot(input(null)).section).toBeNull()
    expect(sessionSnapshot(input(28)).section).toBeNull() // compás 15, sin sección
  })
})

describe('resumePositionS', () => {
  it('retoma al inicio de la sección guardada', () => {
    const saved = sessionSnapshot(input(13.4))
    expect(resumePositionS(saved, GRID, SECTIONS)).toBe(8) // compás 5
  })

  it('si la sección ya no existe empieza de cero', () => {
    const saved = { section: { name: 'Coro 1', startMeasure: 7 } }
    expect(resumePositionS(saved, GRID, SECTIONS)).toBe(0)
    expect(resumePositionS({ section: null }, GRID, SECTIONS)).toBe(0)
  })
})

describe('sessionSummary', () => {
  it('sección, dificultad y tempo', () => {
    expect(sessionSummary(sessionSnapshot(input(13.4)), 'Completo')).toBe(
      'Coro 1 · Completo · tempo 100%',
    )
    expect(sessionSummary({ section: null, difficulty: 'full', tempo: 0.75 }, 'Completo')).toBe(
      'Desde el principio · Completo · tempo 75%',
    )
  })
})

it('sameSong compara tipo e id', () => {
  expect(sameSong({ kind: 'builtin', id: 'a' }, { kind: 'builtin', id: 'a' })).toBe(true)
  expect(sameSong({ kind: 'builtin', id: 'a' }, { kind: 'library', id: 'a' })).toBe(false)
})

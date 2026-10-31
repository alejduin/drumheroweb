import { describe, expect, it } from 'vitest'
import { PIECES } from '@/types'
import type { ChartGrid, ChartNote, Piece } from '@/types'
import {
  ensureDifficulties,
  generateDifficulties,
  subdivisionOf,
  withGeneratedDifficulties,
} from '@/chart/difficulties'
import { chartIssues } from '@/chart/ChartParser'
import { analyzedChart } from '../fakes/FakeWorkerClient'

// 120 BPM (beat = 0,5 s), compases de 4 tiempos
const beats = Array.from({ length: 33 }, (_, i) => i * 0.5)
const grid: ChartGrid = { beats, downbeats: beats.filter((_, i) => i % 4 === 0) }

/** Nota en la posición `beat` (en negras desde el compás 1). */
const at = (beat: number, piece: Piece, velocity = 90): ChartNote => ({
  t: Math.round(beat * 0.5 * 10_000) / 10_000,
  piece,
  velocity,
  confidence: 0.9,
})

const summary = (notes: readonly ChartNote[]) =>
  notes.map(n => `${Math.round((n.t / 0.5) * 1000) / 1000}:${n.piece}`)

/** Rock en corcheas: hi-hat en corcheas, bombo en 1, 3 y "y" del 3, caja en 2 y 4 + ghost. */
const ROCK: ChartNote[] = [
  ...[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map(b => at(b, 'hihat_closed')),
  at(0, 'kick'),
  at(2, 'kick'),
  at(2.5, 'kick'),
  at(1, 'snare', 100),
  at(3, 'snare', 100),
  at(1.75, 'snare', 30), // ghost en semicorchea
  at(3.5, 'snare', 35), // ghost en corchea
].sort((a, b) => a.t - b.t || PIECES.indexOf(a.piece) - PIECES.indexOf(b.piece))

describe('subdivisionOf', () => {
  it('tiempo, corchea (recta o de shuffle) o más fino', () => {
    expect(subdivisionOf(4)).toBe('beat')
    expect(subdivisionOf(3.99)).toBe('beat')
    expect(subdivisionOf(1.5)).toBe('eighth')
    expect(subdivisionOf(1 + 2 / 3)).toBe('eighth')
    expect(subdivisionOf(1.25)).toBe('fine')
    expect(subdivisionOf(1.75)).toBe('fine')
    expect(subdivisionOf(1 + 1 / 3)).toBe('fine')
  })
})

describe('generateDifficulties', () => {
  it('rock · Básico: bombo y caja en los tiempos, hi-hat en negras, sin ghost', () => {
    const { basic } = generateDifficulties(ROCK, grid)
    expect(summary(basic)).toEqual([
      '0:kick',
      '0:hihat_closed',
      '1:snare',
      '1:hihat_closed',
      '2:kick',
      '2:hihat_closed',
      '3:snare',
      '3:hihat_closed',
    ])
  })

  it('rock · Intermedio: hi-hat en corcheas, bombo en corchea, sin ghost notes', () => {
    const { intermediate } = generateDifficulties(ROCK, grid)
    expect(summary(intermediate)).toEqual([
      '0:kick',
      '0:hihat_closed',
      '0.5:hihat_closed',
      '1:snare',
      '1:hihat_closed',
      '1.5:hihat_closed',
      '2:kick',
      '2:hihat_closed',
      '2.5:kick',
      '2.5:hihat_closed',
      '3:snare',
      '3:hihat_closed',
      '3.5:hihat_closed',
    ])
  })

  it('hi-hat en semicorcheas: Intermedio lo deja en corcheas y Básico en negras', () => {
    const sixteenths = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75].map(b => at(b, 'hihat_closed'))
    const { basic, intermediate } = generateDifficulties(sixteenths, grid)
    expect(summary(intermediate)).toEqual(['0', '0.5', '1', '1.5'].map(b => `${b}:hihat_closed`))
    expect(summary(basic)).toEqual(['0:hihat_closed', '1:hihat_closed'])
  })

  it('shuffle: conserva la corchea de swing (2/3) sin moverla en Intermedio', () => {
    const shuffle = [0, 1, 2, 3].flatMap(b => [at(b, 'ride'), at(b + 2 / 3, 'ride')])
    const { basic, intermediate } = generateDifficulties(shuffle, grid)
    expect(intermediate).toHaveLength(8)
    expect(intermediate[1].t).toBeCloseTo((2 / 3) * 0.5, 3)
    expect(summary(basic)).toEqual(['0:ride', '1:ride', '2:ride', '3:ride'])
  })

  it('fill de toms: Intermedio lo pasa a la caja en corcheas; Básico lo quita', () => {
    const fill = [
      at(4, 'crash'),
      at(4, 'kick'),
      ...[0, 0.25, 0.5, 0.75].map(b => at(b, 'tom1')),
      ...[1, 1.25, 1.5, 1.75].map(b => at(b, 'tom2')),
      ...[2, 2.5].map(b => at(b, 'tom3')),
      at(3, 'snare'),
      at(3, 'tom3'), // golpe simultáneo en caja y tom: queda una sola caja
    ]
    const { basic, intermediate } = generateDifficulties(fill, grid)
    expect(summary(intermediate)).toEqual([
      '0:snare',
      '0.5:snare',
      '1:snare',
      '1.5:snare',
      '2:snare',
      '2.5:snare',
      '3:snare',
      '4:kick',
      '4:crash',
    ])
    expect(summary(basic)).toEqual(['3:snare', '4:kick', '4:crash'])
  })

  it('aro y hi-hat abierto se simplifican; el pedal desaparece', () => {
    const notes = [at(0, 'snare_rim'), at(1, 'hihat_open'), at(2, 'hihat_pedal')]
    const { basic, intermediate } = generateDifficulties(notes, grid)
    expect(summary(basic)).toEqual(['0:snare', '1:hihat_closed'])
    expect(summary(intermediate)).toEqual(['0:snare', '1:hihat_open'])
  })

  it('la densidad crece de Básico a Completo', () => {
    const { basic, intermediate } = generateDifficulties(ROCK, grid)
    expect(basic.length).toBeLessThan(intermediate.length)
    expect(intermediate.length).toBeLessThan(ROCK.length)
  })

  it('conserva confianza y velocity de la nota original', () => {
    const { basic } = generateDifficulties([{ ...at(1, 'snare', 110), confidence: 0.4 }], grid)
    expect(basic[0]).toMatchObject({ velocity: 110, confidence: 0.4 })
  })
})

describe('ensureDifficulties', () => {
  const base = analyzedChart()
  const chart = {
    ...base,
    audioSha256: 'a'.repeat(64),
    grid,
    durationS: 16,
    difficulties: { basic: { notes: [] }, intermediate: { notes: [] }, full: { notes: ROCK } },
  }

  it('genera Básico e Intermedio cuando vienen vacíos (charts del worker)', () => {
    const ready = ensureDifficulties(chart)
    expect(ready.difficulties.basic.notes.length).toBeGreaterThan(0)
    expect(ready.difficulties.intermediate.notes.length).toBeGreaterThan(0)
    expect(ready.difficulties.full).toBe(chart.difficulties.full)
    expect(chartIssues(ready)).toEqual([])
  })

  it('respeta las dificultades que ya vienen hechas', () => {
    const done = withGeneratedDifficulties(chart)
    expect(ensureDifficulties(done)).toBe(done)
  })
})

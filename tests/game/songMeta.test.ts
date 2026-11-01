import { describe, expect, it } from 'vitest'
import { songMeta } from '@/game/songMeta'

describe('songMeta', () => {
  it('dificultad · BPM redondeado · compás · origen', () => {
    const chart = {
      bpm: 103.6,
      timeSignature: [4, 4] as [number, number],
      source: { kind: 'ai' as const, createdAt: '2026-10-24T00:00:00.000Z' },
    }
    expect(songMeta(chart, 'intermediate')).toBe('Intermedio · 104 BPM · 4/4 · transcrita por IA')
    expect(songMeta({ ...chart, source: { ...chart.source, kind: 'builtin' } }, 'full')).toBe(
      'Completo · 104 BPM · 4/4 · incluida en la app',
    )
  })

  it('a otro tempo muestra el BPM que suena y el porcentaje', () => {
    const chart = {
      bpm: 104,
      timeSignature: [4, 4] as [number, number],
      source: { kind: 'ai' as const, createdAt: '2026-10-24T00:00:00.000Z' },
    }
    expect(songMeta(chart, 'full', 0.75)).toBe('Completo · 78 BPM (75 %) · 4/4 · transcrita por IA')
  })
})

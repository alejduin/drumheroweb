import { describe, expect, it } from 'vitest'
import { LEVELS } from '@/types'
import type { ChartNote } from '@/types'
import { LEVEL_POINTS, LEVEL_WINDOWS } from '@/constants/scoring'
import { dynamicForVelocity, needsReview, noteDynamic } from '@/chart/notes'

const note = (over: Partial<ChartNote> = {}): ChartNote => ({
  t: 0,
  piece: 'snare',
  velocity: 80,
  confidence: 0.9,
  ...over,
})

describe('dinámica', () => {
  it('usa los umbrales del worker: < 50 ghost, > 100 acento', () => {
    expect(dynamicForVelocity(49)).toBe('ghost')
    expect(dynamicForVelocity(50)).toBe('normal')
    expect(dynamicForVelocity(100)).toBe('normal')
    expect(dynamicForVelocity(101)).toBe('accent')
  })

  it('la dinámica explícita del chart manda sobre la velocity', () => {
    expect(noteDynamic(note({ velocity: 120, dynamic: 'normal' }))).toBe('normal')
    expect(noteDynamic(note({ velocity: 30 }))).toBe('ghost')
  })

  it('confianza < 0.6 = por revisar', () => {
    expect(needsReview(note({ confidence: 0.59 }))).toBe(true)
    expect(needsReview(note({ confidence: 0.6 }))).toBe(false)
  })
})

describe('ventanas y puntos por nivel (REQUIREMENTS_V2 §6.5)', () => {
  it('coinciden con la tabla', () => {
    expect(LEVEL_WINDOWS).toEqual({
      beginner: { perfectMs: 45, closeMs: 110 },
      intermediate: { perfectMs: 30, closeMs: 80 },
      expert: { perfectMs: 20, closeMs: 50 },
    })
    expect(LEVEL_POINTS.expert).toEqual({ perfect: 100, close: 40 })
    expect(Object.keys(LEVEL_POINTS)).toEqual([...LEVELS])
  })
})

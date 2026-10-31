import { describe, expect, it } from 'vitest'
import type { ChartGrid } from '@/types'
import { RECORD_TAIL_S, recordingPhase, recordingPlan } from '@/editor/recording'

// 120 BPM, compases de 2 s, 8 s
const beats = Array.from({ length: 17 }, (_, i) => i * 0.5)
const grid: ChartGrid = { beats, downbeats: [0, 2, 4, 6] }

describe('recordingPlan', () => {
  it('cuenta de un compás: arranca en el compás anterior al rango', () => {
    expect(recordingPlan(grid, 8, 2, 3)).toEqual({
      playFromS: 0,
      startS: 2,
      endS: 6,
      stopAtS: 6 + RECORD_TAIL_S,
    })
  })

  it('desde el compás 1 la cuenta no puede empezar antes de 0', () => {
    const plan = recordingPlan({ beats, downbeats: [1, 3, 5, 7] }, 8, 1, 1)
    expect(plan.playFromS).toBe(0)
    expect(plan.startS).toBe(1)
    expect(plan.endS).toBe(3)
  })

  it('el último compás termina en durationS y el corte no lo pasa', () => {
    const plan = recordingPlan(grid, 8, 4, 4)
    expect(plan.endS).toBe(8)
    expect(plan.stopAtS).toBe(8)
  })

  it('un rango invertido graba solo el primer compás', () => {
    expect(recordingPlan(grid, 8, 3, 2).endS).toBe(6)
  })
})

describe('recordingPhase', () => {
  const plan = recordingPlan(grid, 8, 2, 2)
  it('cuenta, grabación y fin según el reloj', () => {
    expect(recordingPhase(plan, 0.5)).toBe('countIn')
    expect(recordingPhase(plan, 2)).toBe('recording')
    expect(recordingPhase(plan, 4.2)).toBe('recording') // margen para el último golpe
    expect(recordingPhase(plan, 4 + RECORD_TAIL_S)).toBe('done')
  })
})

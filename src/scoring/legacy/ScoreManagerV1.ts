import { POINTS } from '@/constants/game'
import { HitAccuracy } from '@/types'
import type { HitResult } from '@/types'

function initialAccuracy(): Record<HitAccuracy, number> {
  return { perfect: 0, great: 0, good: 0, miss: 0 }
}

export class ScoreManager {
  private score = 0
  private accuracy = initialAccuracy()

  /** Aplica un HitResult con su multiplicador y devuelve el nuevo score. */
  applyHit(result: HitResult, multiplier: 1 | 2 | 3 | 4): number {
    this.score += POINTS[result.accuracy] * multiplier
    this.accuracy[result.accuracy]++
    return this.score
  }

  reset(): void {
    this.score = 0
    this.accuracy = initialAccuracy()
  }

  getScore(): number {
    return this.score
  }

  getAccuracy(): Record<HitAccuracy, number> {
    return { ...this.accuracy }
  }

  getTotalNotes(): number {
    return Object.values(this.accuracy).reduce((a, b) => a + b, 0)
  }

  /** Ratio de notas acertadas (no miss) sobre el total. 0 si no hay notas. */
  getHitRatio(): number {
    const total = this.getTotalNotes()
    if (total === 0) return 0
    return (total - this.accuracy.miss) / total
  }
}

export const scoreManager = new ScoreManager()

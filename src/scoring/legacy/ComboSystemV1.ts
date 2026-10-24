import { getMultiplier } from '@/constants/game'
import { HitAccuracy } from '@/types'

export class ComboSystem {
  private combo = 0

  /** Procesa un hit y devuelve el nuevo estado de combo y multiplicador. */
  process(accuracy: HitAccuracy): { combo: number; multiplier: 1 | 2 | 3 | 4 } {
    if (accuracy === HitAccuracy.Miss) {
      this.combo = 0
    } else {
      this.combo++
    }
    return { combo: this.combo, multiplier: getMultiplier(this.combo) }
  }

  reset(): void {
    this.combo = 0
  }

  getCombo(): number {
    return this.combo
  }

  getMultiplier(): 1 | 2 | 3 | 4 {
    return getMultiplier(this.combo)
  }
}

export const comboSystem = new ComboSystem()

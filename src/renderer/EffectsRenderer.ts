import { ACCURACY_COLORS, LANES, TIMING_LINE_X_RATIO } from '@/constants/game'
import type { HitAccuracy } from '@/types'

const EFFECT_DURATION_MS = 300
const RIPPLE_MAX_RADIUS = 40

export interface ActiveEffect {
  instrument: (typeof LANES)[number]
  accuracy: HitAccuracy
  createdAt: number // performance.now()
}

/**
 * Registra un nuevo efecto de hit. Llamar desde onHitResult del GameEngine.
 */
export function createEffect(
  effects: ActiveEffect[],
  instrument: ActiveEffect['instrument'],
  accuracy: HitAccuracy,
): ActiveEffect[] {
  const newEffect: ActiveEffect = {
    instrument,
    accuracy,
    createdAt: performance.now(),
  }
  // Máximo 16 efectos simultáneos (un efecto por carril como máximo)
  return [...effects.slice(-15), newEffect]
}

/**
 * Elimina efectos que ya expiraron. Llamar en cada frame.
 */
export function pruneEffects(effects: ActiveEffect[], now: number): ActiveEffect[] {
  return effects.filter(e => now - e.createdAt < EFFECT_DURATION_MS)
}

/**
 * Dibuja todos los efectos activos sobre el canvas.
 */
export function drawEffects(
  ctx: CanvasRenderingContext2D,
  effects: ActiveEffect[],
  width: number,
  height: number,
): void {
  if (effects.length === 0) return

  const now = performance.now()
  const timingLineX = width * TIMING_LINE_X_RATIO
  const laneHeight = height / LANES.length

  for (const effect of effects) {
    const elapsed = now - effect.createdAt
    const progress = elapsed / EFFECT_DURATION_MS // 0 → 1

    const laneIndex = LANES.indexOf(effect.instrument)
    if (laneIndex === -1) continue

    const centerY = laneIndex * laneHeight + laneHeight / 2
    const color = ACCURACY_COLORS[effect.accuracy]

    drawRipple(ctx, timingLineX, centerY, progress, color)
    drawLaneFlash(ctx, timingLineX, laneIndex * laneHeight, laneHeight, progress, color)
  }
}

// ─── Efecto ripple (onda expansiva) ──────────────────────────────────────────

function drawRipple(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  progress: number,
  color: string,
): void {
  const radius = RIPPLE_MAX_RADIUS * progress
  const alpha = 1 - progress

  ctx.globalAlpha = alpha * 0.8
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.shadowColor = color
  ctx.shadowBlur = 10

  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.stroke()

  ctx.globalAlpha = 1
  ctx.shadowBlur = 0
}

// ─── Flash horizontal en el carril ───────────────────────────────────────────

function drawLaneFlash(
  ctx: CanvasRenderingContext2D,
  timingLineX: number,
  laneY: number,
  laneHeight: number,
  progress: number,
  color: string,
): void {
  const alpha = (1 - progress) * 0.35
  if (alpha <= 0) return

  const flashWidth = timingLineX * (1 - progress * 0.5)

  ctx.globalAlpha = alpha
  const gradient = ctx.createLinearGradient(0, 0, timingLineX, 0)
  gradient.addColorStop(0, 'transparent')
  gradient.addColorStop(1, color)

  ctx.fillStyle = gradient
  ctx.fillRect(timingLineX - flashWidth, laneY + 1, flashWidth, laneHeight - 2)

  ctx.globalAlpha = 1
}

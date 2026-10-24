import { ACCURACY_COLORS } from '@/constants/game'
import type { HitAccuracy } from '@/types'

export interface HUDData {
  score: number
  combo: number
  multiplier: 1 | 2 | 3 | 4
  lastAccuracy: HitAccuracy | null
  songProgressRatio: number // 0-1
}

/**
 * Dibuja el HUD sobre el canvas: score, combo, multiplicador, barra de progreso.
 * No limpia el canvas — se llama después de NoteRenderer.
 */
export function drawHUD(
  ctx: CanvasRenderingContext2D,
  data: HUDData,
  width: number,
): void {
  drawProgressBar(ctx, data.songProgressRatio, width)
  drawScore(ctx, data.score, width)
  drawCombo(ctx, data.combo, data.multiplier, data.lastAccuracy)
}

// ─── Barra de progreso (top) ──────────────────────────────────────────────────

function drawProgressBar(
  ctx: CanvasRenderingContext2D,
  ratio: number,
  width: number,
): void {
  const barHeight = 3

  ctx.fillStyle = 'rgba(255,255,255,0.1)'
  ctx.fillRect(0, 0, width, barHeight)

  ctx.fillStyle = '#a855f7'
  ctx.fillRect(0, 0, width * Math.min(1, Math.max(0, ratio)), barHeight)
}

// ─── Score (top right) ────────────────────────────────────────────────────────

function drawScore(
  ctx: CanvasRenderingContext2D,
  score: number,
  width: number,
): void {
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'

  // Sombra para legibilidad sobre el canvas
  ctx.shadowColor = 'rgba(0,0,0,0.8)'
  ctx.shadowBlur = 8

  ctx.font = 'bold 28px system-ui, sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(score.toLocaleString(), width - 16, 16)

  ctx.font = '11px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.fillText('SCORE', width - 16, 50)

  ctx.shadowBlur = 0
}

// ─── Combo (top left, después de las etiquetas de carril) ─────────────────────

function drawCombo(
  ctx: CanvasRenderingContext2D,
  combo: number,
  multiplier: 1 | 2 | 3 | 4,
  lastAccuracy: HitAccuracy | null,
): void {
  if (combo < 2) return

  const x = 80
  const y = 16

  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.shadowColor = 'rgba(0,0,0,0.8)'
  ctx.shadowBlur = 8

  // Número de combo
  ctx.font = 'bold 28px system-ui, sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(`${combo}x`, x, y)

  // Etiqueta COMBO
  ctx.font = '11px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.fillText('COMBO', x, 50)

  // Multiplicador (si > 1)
  if (multiplier > 1) {
    ctx.font = 'bold 14px system-ui, sans-serif'
    ctx.fillStyle = '#ffd700'
    ctx.fillText(`×${multiplier}`, x + 60, y + 6)
  }

  // Texto de precisión del último hit
  if (lastAccuracy && lastAccuracy !== 'miss') {
    ctx.font = 'bold 13px system-ui, sans-serif'
    ctx.fillStyle = ACCURACY_COLORS[lastAccuracy]
    ctx.fillText(lastAccuracy.toUpperCase(), x, 66)
  }

  ctx.shadowBlur = 0
}

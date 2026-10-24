import { FONT_MONO, FONT_SANS, THEME_COLORS } from '@/constants/theme'
import { LANE_LABELS } from './laneLayout'
import type { LaneFrame, LaneGeometry } from './laneLayout'
import { STATE_COLORS, withAlpha } from './palette'

const GHOST_ALPHA = 0.55

/** Carriles, etiquetas y barras de compás: van debajo de la línea de golpe. */
export function drawLaneBackground(
  ctx: CanvasRenderingContext2D,
  frame: LaneFrame,
  geometry: LaneGeometry,
  width: number,
): void {
  const s = geometry.scale

  geometry.lanes.forEach((lane, i) => {
    if (i % 2 === 1) {
      ctx.fillStyle = withAlpha(THEME_COLORS['paper-chip'], 0.5)
      ctx.fillRect(0, lane.top, width, lane.height)
    }
  })

  ctx.strokeStyle = withAlpha(THEME_COLORS['paper-ink'], 0.35)
  ctx.lineWidth = 1.5 * s
  ctx.beginPath()
  for (const bar of frame.bars) {
    ctx.moveTo(bar.x, geometry.top)
    ctx.lineTo(bar.x, geometry.bottom)
  }
  ctx.stroke()

  ctx.fillStyle = THEME_COLORS.faint
  ctx.font = `500 ${11 * s}px ${FONT_MONO}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  for (const bar of frame.bars) {
    ctx.fillText(String(bar.measure), bar.x + 4 * s, geometry.bottom + 3 * s)
  }
}

/** Etiquetas de carril, encima de las notas que ya pasaron la línea (con un fundido). */
export function drawLaneLabels(
  ctx: CanvasRenderingContext2D,
  geometry: LaneGeometry,
  hitX: number,
): void {
  const s = geometry.scale
  const gutter = Math.min(84 * s, hitX - 24 * s)
  const fade = ctx.createLinearGradient(0, 0, gutter + 24 * s, 0)
  fade.addColorStop(0, THEME_COLORS.paper)
  fade.addColorStop(gutter / (gutter + 24 * s), THEME_COLORS.paper)
  fade.addColorStop(1, withAlpha(THEME_COLORS.paper, 0))
  ctx.fillStyle = fade
  ctx.fillRect(0, geometry.top, gutter + 24 * s, geometry.bottom - geometry.top)

  ctx.fillStyle = THEME_COLORS['paper-muted']
  ctx.font = `600 ${Math.min(12 * s, (geometry.lanes[0]?.height ?? 24) * 0.5)}px ${FONT_SANS}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (const lane of geometry.lanes) {
    ctx.fillText(LANE_LABELS[lane.id], geometry.labelX, lane.centerY)
  }
}

/** Notas: van encima del resplandor de la línea. */
export function drawLaneNotes(
  ctx: CanvasRenderingContext2D,
  frame: LaneFrame,
  geometry: LaneGeometry,
): void {
  const s = geometry.scale
  for (const note of frame.notes) {
    const color = STATE_COLORS[note.state]
    ctx.globalAlpha = note.radius < geometry.noteRadius && note.state === 'future' ? GHOST_ALPHA : 1
    ctx.beginPath()
    ctx.arc(note.x, note.y, note.radius, 0, Math.PI * 2)
    if (note.open) {
      // Hi-hat abierto: anillo
      ctx.strokeStyle = color
      ctx.lineWidth = 3 * s
      ctx.stroke()
    } else {
      ctx.fillStyle = color
      ctx.fill()
    }
    if (note.accent) {
      ctx.strokeStyle = color
      ctx.lineWidth = 2 * s
      ctx.beginPath()
      ctx.arc(note.x, note.y, note.radius + 4 * s, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1
}

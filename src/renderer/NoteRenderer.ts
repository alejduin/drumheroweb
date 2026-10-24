import {
  BASE_SCROLL_SPEED_PX_PER_MS,
  INSTRUMENT_COLORS,
  LANES,
  TIMING_LINE_X_RATIO,
} from '@/constants/game'
import type { NoteEvent } from '@/types'

const NOTE_RADIUS = 16
const NOTE_BORDER_WIDTH = 3
const LANE_LABEL_WIDTH = 64
const GRID_LINE_COLOR = 'rgba(255,255,255,0.06)'
const TIMING_LINE_COLOR = '#a855f7'
const TIMING_LINE_WIDTH = 3
const LANE_BG_ODD = 'rgba(255,255,255,0.02)'
const LANE_BG_EVEN = 'transparent'

export interface NoteRendererOptions {
  scrollSpeed?: number // multiplicador sobre BASE_SCROLL_SPEED_PX_PER_MS
}

/**
 * Dibuja todos los carriles, la línea de timing, y las notas visibles.
 * Llamado en cada frame del RAF loop.
 */
export function drawNotes(
  ctx: CanvasRenderingContext2D,
  gameTimeMs: number,
  notes: NoteEvent[],
  width: number,
  height: number,
  options: NoteRendererOptions = {},
): void {
  const scrollSpeed = (options.scrollSpeed ?? 1) * BASE_SCROLL_SPEED_PX_PER_MS
  const timingLineX = Math.round(width * TIMING_LINE_X_RATIO)
  const laneCount = LANES.length
  const laneHeight = height / laneCount

  drawLaneBackgrounds(ctx, width, laneCount, laneHeight)
  drawLaneLabels(ctx, laneCount, laneHeight)
  drawTimingLine(ctx, timingLineX, height)
  drawVisibleNotes(ctx, notes, gameTimeMs, timingLineX, laneHeight, scrollSpeed, width)
}

// ─── Fondos de carriles ────────────────────────────────────────────────────────

function drawLaneBackgrounds(
  ctx: CanvasRenderingContext2D,
  width: number,
  laneCount: number,
  laneHeight: number,
): void {
  for (let i = 0; i < laneCount; i++) {
    const y = i * laneHeight

    // Fondo alternado
    ctx.fillStyle = i % 2 === 0 ? LANE_BG_EVEN : LANE_BG_ODD
    ctx.fillRect(0, y, width, laneHeight)

    // Separador horizontal
    ctx.strokeStyle = GRID_LINE_COLOR
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
}

// ─── Etiquetas de carril ──────────────────────────────────────────────────────

function drawLaneLabels(
  ctx: CanvasRenderingContext2D,
  laneCount: number,
  laneHeight: number,
): void {
  ctx.font = '11px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  for (let i = 0; i < laneCount; i++) {
    const instrument = LANES[i]
    const centerY = i * laneHeight + laneHeight / 2
    const color = INSTRUMENT_COLORS[instrument]

    // Barra de color a la izquierda
    ctx.fillStyle = color
    ctx.fillRect(0, i * laneHeight + 1, 4, laneHeight - 2)

    // Nombre del instrumento
    ctx.fillStyle = `${color}99`
    ctx.fillText(formatInstrumentLabel(instrument), 10, centerY)
  }
}

function formatInstrumentLabel(instrument: string): string {
  return instrument
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace('Hihat', 'HiHat')
}

// ─── Línea de timing ──────────────────────────────────────────────────────────

function drawTimingLine(ctx: CanvasRenderingContext2D, x: number, height: number): void {
  ctx.strokeStyle = TIMING_LINE_COLOR
  ctx.lineWidth = TIMING_LINE_WIDTH
  ctx.shadowColor = TIMING_LINE_COLOR
  ctx.shadowBlur = 8

  ctx.beginPath()
  ctx.moveTo(x, 0)
  ctx.lineTo(x, height)
  ctx.stroke()

  ctx.shadowBlur = 0
}

// ─── Notas ────────────────────────────────────────────────────────────────────

function drawVisibleNotes(
  ctx: CanvasRenderingContext2D,
  notes: NoteEvent[],
  gameTimeMs: number,
  timingLineX: number,
  laneHeight: number,
  scrollSpeed: number,
  canvasWidth: number,
): void {
  for (const note of notes) {
    const timeDelta = note.absoluteTimeMs - gameTimeMs
    const x = timingLineX + timeDelta * scrollSpeed

    // Culling: no dibujar notas fuera del canvas
    if (x < -NOTE_RADIUS * 2 || x > canvasWidth + NOTE_RADIUS) continue

    const laneIndex = LANES.indexOf(note.instrument)
    if (laneIndex === -1) continue

    const y = laneIndex * laneHeight + laneHeight / 2
    const color = INSTRUMENT_COLORS[note.instrument]

    // Las notas que ya pasaron la línea de timing se atenúan
    const alpha = timeDelta < 0 ? Math.max(0, 1 + timeDelta / 150) : 1

    drawNote(ctx, x, y, color, alpha)
  }
}

function drawNote(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  alpha: number,
): void {
  ctx.globalAlpha = alpha

  // Halo exterior
  ctx.shadowColor = color
  ctx.shadowBlur = 12
  ctx.fillStyle = `${color}33`
  ctx.beginPath()
  ctx.arc(x, y, NOTE_RADIUS + 4, 0, Math.PI * 2)
  ctx.fill()

  // Círculo principal
  ctx.shadowBlur = 6
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, NOTE_RADIUS, 0, Math.PI * 2)
  ctx.fill()

  // Borde interior blanco
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  ctx.lineWidth = NOTE_BORDER_WIDTH
  ctx.beginPath()
  ctx.arc(x, y, NOTE_RADIUS - NOTE_BORDER_WIDTH, 0, Math.PI * 2)
  ctx.stroke()

  ctx.shadowBlur = 0
  ctx.globalAlpha = 1
}

// Re-exportar constantes útiles para otros módulos
export { LANE_LABEL_WIDTH, NOTE_RADIUS }

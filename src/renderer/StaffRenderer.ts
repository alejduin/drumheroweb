import { FONT_MONO, FONT_SANS, THEME_COLORS } from '@/constants/theme'
import { STATE_COLORS } from './palette'
import { stepY } from './staffLayout'
import type { ChordLayout, HeadLayout, StaffFrame, StaffGeometry } from './staffLayout'

const STAFF_STEPS = [0, 2, 4, 6, 8]
const GHOST_ALPHA = 0.55
const HEAD_ROTATION = (-20 * Math.PI) / 180

/** Líneas y barras de compás: van debajo de la línea de golpe. */
export function drawStaffBackground(
  ctx: CanvasRenderingContext2D,
  frame: StaffFrame,
  geometry: StaffGeometry,
  width: number,
): void {
  const s = geometry.scale
  const top = stepY(geometry, 0)
  const bottom = stepY(geometry, 8)

  ctx.strokeStyle = THEME_COLORS['paper-ink']
  ctx.lineWidth = 1.5 * s
  ctx.beginPath()
  for (const step of STAFF_STEPS) {
    const y = stepY(geometry, step)
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
  }
  ctx.stroke()

  ctx.lineWidth = 2 * s
  ctx.beginPath()
  for (const bar of frame.bars) {
    ctx.moveTo(bar.x, top)
    ctx.lineTo(bar.x, bottom)
  }
  ctx.stroke()

  ctx.fillStyle = THEME_COLORS.faint
  ctx.font = `500 ${11 * s}px ${FONT_MONO}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  for (const bar of frame.bars) {
    ctx.fillText(String(bar.measure), bar.x + 4 * s, geometry.measureNumberY)
  }
}

/** Notas, plicas y barras de figura: van encima del resplandor de la línea. */
export function drawStaffNotes(
  ctx: CanvasRenderingContext2D,
  frame: StaffFrame,
  geometry: StaffGeometry,
): void {
  const s = geometry.scale

  ctx.strokeStyle = THEME_COLORS['paper-ink']
  ctx.lineWidth = 1.5 * s
  ctx.beginPath()
  for (const ledger of frame.ledgers) {
    ctx.moveTo(ledger.x1, ledger.y)
    ctx.lineTo(ledger.x2, ledger.y)
  }
  ctx.stroke()

  ctx.lineWidth = 2 * s
  ctx.lineCap = 'butt'
  for (const chord of frame.chords) {
    ctx.strokeStyle = STATE_COLORS[chord.stemState]
    ctx.beginPath()
    ctx.moveTo(chord.stemX, chord.stemBottomY)
    ctx.lineTo(chord.stemX, geometry.stemTopY)
    ctx.stroke()
  }

  for (const beam of frame.beams) {
    ctx.fillStyle = STATE_COLORS[beam.state]
    ctx.fillRect(
      beam.x1 - s,
      beam.y - geometry.beamThickness / 2,
      beam.x2 - beam.x1 + 2 * s,
      geometry.beamThickness,
    )
  }

  ctx.lineWidth = 2.5 * s
  ctx.lineCap = 'round'
  for (const flag of frame.flags) {
    ctx.strokeStyle = STATE_COLORS[flag.state]
    for (let l = 0; l < flag.level; l++) {
      const y = flag.y + l * (geometry.beamThickness + geometry.beamGap)
      ctx.beginPath()
      ctx.moveTo(flag.x, y)
      ctx.quadraticCurveTo(flag.x + 10 * s, y + 6 * s, flag.x + 8 * s, y + 16 * s)
      ctx.stroke()
    }
  }

  for (const chord of frame.chords) {
    for (const head of chord.heads) drawHead(ctx, chord, head, geometry)
    drawAnnotations(ctx, chord, geometry)
  }
  ctx.lineCap = 'butt'
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  chord: ChordLayout,
  head: HeadLayout,
  geometry: StaffGeometry,
): void {
  const s = geometry.scale
  const k = head.ghost ? geometry.ghostScale : 1
  const color = STATE_COLORS[head.state]
  ctx.globalAlpha = head.ghost && head.state === 'future' ? GHOST_ALPHA : 1

  if (head.shape === 'x') {
    const r = 6 * s * k
    ctx.strokeStyle = color
    ctx.lineWidth = 2.5 * s
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(chord.x - r, head.y - r)
    ctx.lineTo(chord.x + r, head.y + r)
    ctx.moveTo(chord.x + r, head.y - r)
    ctx.lineTo(chord.x - r, head.y + r)
    ctx.stroke()
  } else {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.ellipse(
      chord.x,
      head.y,
      geometry.headRx * k,
      geometry.headRy * k,
      HEAD_ROTATION,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }
  ctx.globalAlpha = 1

  if (head.ghost) {
    ctx.fillStyle = THEME_COLORS.faint
    ctx.font = `700 ${14 * s}px ${FONT_SANS}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('(   )', chord.x, head.y)
  }

  if (head.open) {
    ctx.strokeStyle = color
    ctx.lineWidth = 2 * s
    ctx.beginPath()
    ctx.arc(chord.x, geometry.openMarkY, 5 * s, 0, Math.PI * 2)
    ctx.stroke()
  }
}

function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  chord: ChordLayout,
  geometry: StaffGeometry,
): void {
  const s = geometry.scale
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  if (chord.accent) {
    ctx.fillStyle = THEME_COLORS['paper-muted']
    ctx.font = `700 ${13 * s}px ${FONT_SANS}`
    ctx.fillText('>', chord.x, geometry.accentY)
  }
  if (chord.label) {
    ctx.fillStyle = STATE_COLORS[chord.label === 'fallo' ? 'miss' : 'close']
    ctx.font = `700 ${11 * s}px ${FONT_SANS}`
    ctx.fillText(chord.label, chord.x, geometry.labelY)
  }
}

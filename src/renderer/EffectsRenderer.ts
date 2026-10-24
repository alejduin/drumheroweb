import { FONT_SANS, THEME_COLORS } from '@/constants/theme'
import type { Judgement } from '@/types'
import type { TimedJudgement } from '@/engine/GameEngine'
import { withAlpha } from './palette'

// ─── Efectos en la línea de golpe ─────────────────────────────────────────────
// Los efectos duran tiempo real (performance.now()), no tiempo de canción: se
// pintan igual con el audio en pausa o a otro tempo. Se registran en el mismo
// callback del juicio, así el destello sale en el siguiente frame pintado.

export const GLOW_DURATION_MS = 280
export const BADGE_DURATION_MS = 700
const MAX_GLOWS = 16

export type GlowKind = 'perfect' | 'close' | 'wrong'

export interface Glow {
  kind: GlowKind
  y: number
  bornMs: number
}

export interface Badge {
  judgement: Exclude<Judgement, 'wrong_pad'>
  text: string
  bornMs: number
}

const BADGE_LABELS: Record<Badge['judgement'], string> = {
  perfect: 'PERFECTO',
  close: 'CERCA',
  miss: 'FALLO',
}

export function badgeText(j: TimedJudgement): string | null {
  if (j.judgement === 'wrong_pad') return null
  if (j.judgement === 'miss') return BADGE_LABELS.miss
  return `${BADGE_LABELS[j.judgement]} +${j.points + j.dynamicBonus}`
}

/** 0 al nacer → 1 al terminar; null si ya terminó. */
export function effectProgress(bornMs: number, durationMs: number, nowMs: number): number | null {
  const p = (nowMs - bornMs) / durationMs
  return p < 0 || p >= 1 ? null : p
}

/** Efectos vivos: resplandores en la línea y el badge del último juicio. */
export class HitEffects {
  glows: Glow[] = []
  badge: Badge | null = null

  /** `y` = altura de la pieza en la vista actual (null si no se muestra). */
  push(j: TimedJudgement, y: number | null, nowMs: number): void {
    const text = badgeText(j)
    if (j.judgement !== 'wrong_pad' && text) {
      this.badge = { judgement: j.judgement, text, bornMs: nowMs }
    }
    if (y === null || j.judgement === 'miss') return
    const kind: GlowKind = j.judgement === 'wrong_pad' ? 'wrong' : j.judgement
    this.glows.push({ kind, y, bornMs: nowMs })
    if (this.glows.length > MAX_GLOWS) this.glows.shift()
  }

  /** Quita lo que ya terminó. Llamar una vez por frame antes de pintar. */
  prune(nowMs: number): void {
    this.glows = this.glows.filter(g => effectProgress(g.bornMs, GLOW_DURATION_MS, nowMs) !== null)
    if (this.badge && effectProgress(this.badge.bornMs, BADGE_DURATION_MS, nowMs) === null) {
      this.badge = null
    }
  }

  clear(): void {
    this.glows = []
    this.badge = null
  }
}

// ─── Pintado ──────────────────────────────────────────────────────────────────

const GLOW_COLORS: Record<GlowKind, { fill: string; ring: string }> = {
  perfect: { fill: THEME_COLORS['perfect-fg'], ring: THEME_COLORS.perfect },
  close: { fill: THEME_COLORS['close-fg'], ring: THEME_COLORS.close },
  wrong: { fill: THEME_COLORS.wrong, ring: THEME_COLORS.wrong },
}

const BADGE_COLORS: Record<Badge['judgement'], string> = {
  perfect: THEME_COLORS['perfect-strong'],
  close: THEME_COLORS.close,
  miss: THEME_COLORS.miss,
}

export interface HitLineBounds {
  x: number
  top: number
  bottom: number
  scale: number
}

/** Medidas de la maqueta (panel de 300 px): la línea ocupa la altura de la partitura. */
export function hitLineBounds(x: number, height: number): HitLineBounds {
  const scale = height / 300
  return { x, top: 20 * scale, bottom: 268 * scale, scale }
}

/** Línea de golpe en color de acento (maqueta: halo, barra y dos flechas). */
export function drawHitLine(
  ctx: CanvasRenderingContext2D,
  line: HitLineBounds,
  accent: string,
): void {
  const s = line.scale
  const { x, top, bottom } = line
  ctx.fillStyle = withAlpha(accent, 0.18)
  roundRect(ctx, x - 12 * s, top, 24 * s, bottom - top, 12 * s)
  ctx.fillStyle = accent
  roundRect(ctx, x - 4 * s, top + 8 * s, 8 * s, bottom - top - 16 * s, 4 * s)
  ctx.beginPath()
  ctx.moveTo(x - 12 * s, top)
  ctx.lineTo(x + 12 * s, top)
  ctx.lineTo(x, top + 14 * s)
  ctx.moveTo(x - 12 * s, bottom)
  ctx.lineTo(x + 12 * s, bottom)
  ctx.lineTo(x, bottom - 14 * s)
  ctx.fill()
}

/** Resplandor (y rayos si es Perfecto) a la altura de la pieza tocada. */
export function drawGlows(
  ctx: CanvasRenderingContext2D,
  effects: HitEffects,
  x: number,
  scale: number,
  nowMs: number,
): void {
  const s = scale
  for (const glow of effects.glows) {
    const p = effectProgress(glow.bornMs, GLOW_DURATION_MS, nowMs)
    if (p === null) continue
    const colors = GLOW_COLORS[glow.kind]
    const fade = 1 - p
    const grow = 0.8 + 0.4 * p

    if (glow.kind !== 'wrong') {
      ctx.globalAlpha = 0.22 * fade
      ctx.fillStyle = colors.fill
      ctx.beginPath()
      ctx.arc(x, glow.y, 34 * s * grow, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.globalAlpha = fade
    ctx.strokeStyle = colors.ring
    ctx.lineWidth = 3 * s
    ctx.beginPath()
    ctx.arc(x, glow.y, (glow.kind === 'wrong' ? 16 : 22) * s * grow, 0, Math.PI * 2)
    ctx.stroke()

    if (glow.kind === 'perfect') drawRays(ctx, x, glow.y, s * grow)
  }
  ctx.globalAlpha = 1
}

function drawRays(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (let k = 0; k < 8; k++) {
    const angle = (k * Math.PI) / 4
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    ctx.moveTo(x + cos * 36 * s, y + sin * 36 * s)
    ctx.lineTo(x + cos * 48 * s, y + sin * 48 * s)
  }
  ctx.stroke()
  ctx.lineCap = 'butt'
}

/** Badge "PERFECTO +100" junto a la línea, arriba. */
export function drawBadge(
  ctx: CanvasRenderingContext2D,
  effects: HitEffects,
  x: number,
  scale: number,
  nowMs: number,
): void {
  const badge = effects.badge
  if (!badge) return
  const p = effectProgress(badge.bornMs, BADGE_DURATION_MS, nowMs)
  if (p === null) return
  const s = scale
  ctx.font = `800 ${13 * s}px ${FONT_SANS}`
  ctx.letterSpacing = `${0.06 * 13 * s}px`
  const width = ctx.measureText(badge.text).width + 20 * s
  const left = x + 21 * s
  const top = 14 * s - 4 * s * Math.min(p * 4, 1) // sube un poco al aparecer

  ctx.globalAlpha = p > 0.7 ? (1 - p) / 0.3 : 1
  ctx.fillStyle = BADGE_COLORS[badge.judgement]
  roundRect(ctx, left, top, width, 28 * s, 8 * s)
  ctx.fillStyle = THEME_COLORS['paper-active']
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(badge.text, left + 10 * s, top + 14.5 * s)
  ctx.letterSpacing = '0px'
  ctx.globalAlpha = 1
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
}

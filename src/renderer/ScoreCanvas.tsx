import { useEffect, useRef } from 'react'
import type { SongClock } from '@/audio/AudioClock'
import { THEME_COLORS } from '@/constants/theme'
import type { ChartGrid, ChartNote } from '@/types'
import type { GameEngine } from '@/engine/GameEngine'
import { HitEffects, drawBadge, drawGlows, drawHitLine, hitLineBounds } from './EffectsRenderer'
import { drawLaneBackground, drawLaneLabels, drawLaneNotes } from './LaneRenderer'
import { createLaneGeometry, laneY, lanesForNotes, layoutLanes } from './laneLayout'
import { NoteStates } from './noteStates'
import { drawStaffBackground, drawStaffNotes } from './StaffRenderer'
import { buildStaffModel, createStaffGeometry, layoutStaff, pieceY } from './staffLayout'
import { createTimeline } from './timeline'

export type ScoreView = 'staff' | 'lanes'

/** Lo que el canvas necesita del engine (un fake en la demo o en tests). */
export type ScoreSource = Pick<GameEngine, 'judgements' | 'onJudgement' | 'onReset'>

interface ScoreCanvasProps {
  source: ScoreSource
  clock: SongClock
  notes: readonly ChartNote[]
  grid: ChartGrid
  view: ScoreView
  accent: string
  scrollSpeed?: number
  /** Tras pintar cada frame (medidor de fps de la demo). */
  onFrame?: (nowMs: number) => void
}

/**
 * Partitura en canvas sobre papel claro (PLAN_V2 D7). Imperativo: lee el reloj en
 * cada requestAnimationFrame y pinta; React no se re-renderiza por frame.
 * Los juicios llegan por suscripción al engine y marcan las notas y los efectos.
 */
export function ScoreCanvas({
  source,
  clock,
  notes,
  grid,
  view,
  accent,
  scrollSpeed = 1,
  onFrame,
}: ScoreCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const settings = useRef({ view, accent, scrollSpeed, onFrame })

  useEffect(() => {
    settings.current = { view, accent, scrollSpeed, onFrame }
  }, [view, accent, scrollSpeed, onFrame])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const model = buildStaffModel(notes, grid)
    const lanes = lanesForNotes(notes)
    const states = new NoteStates(notes.length)
    const effects = new HitEffects()
    states.rebuild(source.judgements)

    let size = { width: 0, height: 0 }
    let staffGeometry = createStaffGeometry(1)
    let laneGeometry = createLaneGeometry(1, lanes)

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      size = { width: rect.width, height: rect.height }
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      staffGeometry = createStaffGeometry(rect.height)
      laneGeometry = createLaneGeometry(rect.height, lanes)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const yFor = (piece: ChartNote['piece']) =>
      settings.current.view === 'staff' ? pieceY(staffGeometry, piece) : laneY(laneGeometry, piece)

    const unsubJudgement = source.onJudgement(j => {
      states.apply(j)
      effects.push(j, yFor(j.piece), performance.now())
    })
    const unsubReset = source.onReset(log => {
      states.rebuild(log)
      effects.clear()
    })

    let frameId = requestAnimationFrame(function frame() {
      frameId = requestAnimationFrame(frame)
      const nowMs = performance.now()
      const now = clock.now()
      const { view: currentView, accent: accentColor } = settings.current
      const { width, height } = size
      const timeline = createTimeline(width, settings.current.scrollSpeed)

      ctx.fillStyle = THEME_COLORS.paper
      ctx.fillRect(0, 0, width, height)
      effects.prune(nowMs)

      const line = hitLineBounds(timeline.hitX, height)
      const { scale } = line
      if (currentView === 'staff') {
        const staff = layoutStaff(model, staffGeometry, timeline, now, states)
        drawStaffBackground(ctx, staff, staffGeometry, width)
        drawHitLine(ctx, line, accentColor)
        drawGlows(ctx, effects, timeline.hitX, scale, nowMs)
        drawStaffNotes(ctx, staff, staffGeometry)
      } else {
        const frameLanes = layoutLanes(notes, model.bars, laneGeometry, timeline, now, states)
        drawLaneBackground(ctx, frameLanes, laneGeometry, width)
        drawHitLine(ctx, line, accentColor)
        drawGlows(ctx, effects, timeline.hitX, scale, nowMs)
        drawLaneNotes(ctx, frameLanes, laneGeometry)
        drawLaneLabels(ctx, laneGeometry, timeline.hitX)
      }
      drawBadge(ctx, effects, timeline.hitX, scale, nowMs)
      settings.current.onFrame?.(nowMs)
    })

    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
      unsubJudgement()
      unsubReset()
    }
  }, [source, clock, notes, grid])

  return <canvas ref={canvasRef} className="block h-full w-full" />
}

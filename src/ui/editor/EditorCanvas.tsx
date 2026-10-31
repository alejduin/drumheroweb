import { useEffect, useMemo, useRef } from 'react'
import type { MutableRefObject, MouseEvent, WheelEvent } from 'react'
import type { SongClock } from '@/audio/AudioClock'
import { THEME_COLORS, currentAccent } from '@/constants/theme'
import type { ChartGrid, Piece } from '@/types'
import { needsReview } from '@/chart/notes'
import type { EditorNote } from '@/editor/editorState'
import { editorTimeline, noteAt, pieceAtY, xToTime } from '@/editor/editorView'
import { drawStaffBackground, drawStaffNotes } from '@/renderer/StaffRenderer'
import {
  buildStaffModel,
  createStaffGeometry,
  layoutStaff,
  stepY,
  STAFF_POSITIONS,
} from '@/renderer/staffLayout'
import type { StaffFrame, StaffGeometry } from '@/renderer/staffLayout'
import type { NoteStateSource } from '@/renderer/noteStates'

/** Vista del editor: segundo en el borde izquierdo. La escriben el canvas y la pantalla. */
export interface EditorView {
  startS: number
}

// Al reproducir, el cursor se mantiene entre el 15 % y el 85 % del ancho
const FOLLOW_MIN = 0.15
const FOLLOW_MAX = 0.85

interface EditorCanvasProps {
  notes: readonly EditorNote[]
  selection: readonly number[]
  grid: ChartGrid
  durationS: number
  clock: SongClock
  view: MutableRefObject<EditorView>
  onNoteClick: (id: number, additive: boolean) => void
  onEmptyClick: (t: number, piece: Piece) => void
}

/**
 * Partitura completa para editar (PLAN_V2 C3). Reusa el layout y el pintado del
 * pentagrama; dudosas en ámbar y seleccionadas con un aro. Imperativo como
 * ScoreCanvas: pinta en cada frame leyendo refs, sin re-render.
 */
export function EditorCanvas({
  notes,
  selection,
  grid,
  durationS,
  clock,
  view,
  onNoteClick,
  onEmptyClick,
}: EditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const model = useMemo(() => buildStaffModel(notes, grid), [notes, grid])
  const selected = useMemo(() => new Set(selection), [selection])
  const latest = useRef({ model, selected, notes })
  // Lo último pintado, para saber qué hay bajo el clic
  const painted = useRef<{ frame: StaffFrame; geometry: StaffGeometry; width: number } | null>(null)

  useEffect(() => {
    latest.current = { model, selected, notes }
  }, [model, selected, notes])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const accent = currentAccent()
    let size = { width: 0, height: 0 }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      size = { width: rect.width, height: rect.height }
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    let frameId = requestAnimationFrame(function frame() {
      frameId = requestAnimationFrame(frame)
      const { width, height } = size
      const { model: staff, selected: chosen, notes: current } = latest.current
      const geometry = createStaffGeometry(height)
      const timeline = editorTimeline(width)
      const visibleS = width / timeline.pxPerSecond
      const now = clock.now()

      if (clock.isPlaying) {
        const v = view.current
        if (now < v.startS + visibleS * FOLLOW_MIN || now > v.startS + visibleS * FOLLOW_MAX) {
          v.startS = now - visibleS * FOLLOW_MIN
        }
      }
      const startS = Math.min(Math.max(view.current.startS, -1), Math.max(durationS - 1, 0))
      view.current.startS = startS

      const states: NoteStateSource = {
        stateOf: i => (current[i] && needsReview(current[i]) ? 'close' : 'future'),
        timingOf: () => null,
      }
      const layout = layoutStaff(staff, geometry, timeline, startS, states)
      painted.current = { frame: layout, geometry, width }

      ctx.fillStyle = THEME_COLORS.paper
      ctx.fillRect(0, 0, width, height)
      drawStaffBackground(ctx, layout, geometry, width)
      drawStaffNotes(ctx, layout, geometry)

      // Aro de selección
      ctx.strokeStyle = accent
      ctx.lineWidth = 2.5 * geometry.scale
      for (const chord of layout.chords) {
        for (const head of chord.heads) {
          if (!chosen.has(current[head.noteIndex]?.id)) continue
          const y = stepY(geometry, STAFF_POSITIONS[head.piece].step)
          ctx.beginPath()
          ctx.arc(chord.x, y, geometry.headRx * 1.7, 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      // Cursor de reproducción
      const cursorX = (now - startS) * timeline.pxPerSecond
      if (cursorX >= 0 && cursorX <= width) {
        ctx.fillStyle = accent
        ctx.fillRect(cursorX - 1, 0, 2, height)
      }
    })

    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
    }
  }, [clock, view, durationS])

  function onClick(e: MouseEvent<HTMLCanvasElement>) {
    const last = painted.current
    if (!last) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const index = noteAt(last.frame, last.geometry, x, y)
    const note = index === null ? undefined : latest.current.notes[index]
    if (note) onNoteClick(note.id, e.shiftKey)
    else {
      const t = xToTime(editorTimeline(last.width), view.current.startS, x)
      onEmptyClick(t, pieceAtY(last.geometry, y))
    }
  }

  function onWheel(e: WheelEvent<HTMLCanvasElement>) {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    view.current.startS += delta / editorTimeline(1).pxPerSecond
  }

  return (
    <canvas
      ref={canvasRef}
      aria-label="Partitura para editar"
      className="block h-full w-full cursor-crosshair"
      onClick={onClick}
      onWheel={onWheel}
    />
  )
}

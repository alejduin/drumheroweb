import type { Piece } from '@/types'
import { STAFF_POSITIONS, stepY } from '@/renderer/staffLayout'
import type { StaffFrame, StaffGeometry } from '@/renderer/staffLayout'
import type { Timeline } from '@/renderer/timeline'

// ─── Geometría del canvas del editor (puro) ──────────────────────────────────
// La vista es una ventana fija sobre la canción: x = (t − inicio) · px/s.

/** Separación base entre segundos (zoom 1). */
export const EDITOR_PX_PER_S = 240

/** Pieza que se agrega al hacer clic en cada altura del pentagrama. */
const STEP_PIECES: ReadonlyArray<[number, Piece]> = [
  [-2, 'crash'],
  [-1, 'hihat_closed'],
  [0, 'ride'],
  [1, 'tom1'],
  [2, 'tom2'],
  [3, 'snare'],
  [5, 'tom3'],
  [7, 'kick'],
  [9, 'hihat_pedal'],
]

export function editorTimeline(width: number, zoom = 1): Timeline {
  return { hitX: 0, pxPerSecond: EDITOR_PX_PER_S * zoom, width }
}

export const xToTime = (timeline: Timeline, startS: number, x: number) =>
  startS + x / timeline.pxPerSecond

/** Pieza de la altura más cercana al clic. */
export function pieceAtY(geometry: StaffGeometry, y: number): Piece {
  const step = ((y - geometry.topLineY) * 2) / geometry.lineSpacing
  let best = STEP_PIECES[0]
  for (const entry of STEP_PIECES) {
    if (Math.abs(entry[0] - step) < Math.abs(best[0] - step)) best = entry
  }
  return best[1]
}

/** Índice de la nota cuya cabeza está bajo el punto, o null. */
export function noteAt(
  frame: StaffFrame,
  geometry: StaffGeometry,
  x: number,
  y: number,
): number | null {
  const rx = geometry.headRx * 1.6
  const ry = geometry.lineSpacing * 0.45
  let best: { index: number; distance: number } | null = null
  for (const chord of frame.chords) {
    if (Math.abs(chord.x - x) > rx) continue
    for (const head of chord.heads) {
      const dy = Math.abs(stepY(geometry, STAFF_POSITIONS[head.piece].step) - y)
      if (dy > ry) continue
      const distance = Math.hypot(chord.x - x, dy)
      if (!best || distance < best.distance) best = { index: head.noteIndex, distance }
    }
  }
  return best?.index ?? null
}

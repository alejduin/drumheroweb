// ─── Eje de tiempo de la partitura ────────────────────────────────────────────
// Común a Pentagrama y Carriles: la línea de golpe está fija y las notas se
// desplazan hacia ella a velocidad constante (x proporcional al tiempo).

/** Posición de la línea de golpe sobre el ancho del canvas (PLAN_V2 §4.3). */
export const HIT_LINE_X_RATIO = 0.17

/** Segundos visibles a la derecha de la línea con velocidad de scroll 1. */
export const BASE_LOOKAHEAD_S = 3.5

export interface Timeline {
  hitX: number
  pxPerSecond: number
  width: number
}

/** `scrollSpeed` > 1 separa más las notas (se ven menos segundos por delante). */
export function createTimeline(width: number, scrollSpeed = 1): Timeline {
  const hitX = Math.round(width * HIT_LINE_X_RATIO)
  const lookaheadS = BASE_LOOKAHEAD_S / Math.max(scrollSpeed, 0.1)
  return { hitX, pxPerSecond: (width - hitX) / lookaheadS, width }
}

export function timeToX(timeline: Timeline, t: number, now: number): number {
  return timeline.hitX + (t - now) * timeline.pxPerSecond
}

/** Intervalo de tiempo que cabe en el canvas, con `marginPx` de cada lado. */
export function visibleWindow(
  timeline: Timeline,
  now: number,
  marginPx: number,
): { fromT: number; toT: number } {
  return {
    fromT: now - (timeline.hitX + marginPx) / timeline.pxPerSecond,
    toT: now + (timeline.width - timeline.hitX + marginPx) / timeline.pxPerSecond,
  }
}

/** Primer índice de `items` (ordenados por t) con t >= `t`. */
export function lowerBoundByTime(items: readonly { t: number }[], t: number): number {
  let lo = 0
  let hi = items.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (items[mid].t < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Rango [start, end) de `items` (ordenados por t) dentro de [fromT, toT]. */
export function visibleSlice(
  items: readonly { t: number }[],
  fromT: number,
  toT: number,
): [number, number] {
  const start = lowerBoundByTime(items, fromT)
  let end = start
  while (end < items.length && items[end].t <= toT) end++
  return [start, end]
}

import { TIME_EPSILON_S } from '@/constants/chart'
import type { ChartGrid, ChartSection, ChartV2 } from '@/types'
import { measureAt } from './grid'

// ─── Reparar la rejilla del detector de pulso ─────────────────────────────────
// beat_this a veces inventa beats: en intros sin batería (a destiempo, con
// downbeats a centésimas uno del otro) o duplicados a pocas centésimas a mitad
// de canción. El metrónomo suena "doble" y hay compases aplastados. Tres pasos:
//   1. Intro: se descarta lo anterior al primer tramo de pulso estable y se
//      rellena hacia atrás con ese pulso y compases completos.
//   2. Beats duplicados: de dos beats demasiado juntos queda el que sigue el pulso.
//   3. Zonas revueltas entre dos tramos de pulso estable: si el hueco cabe un
//      número entero de beats, se rehacen equiespaciados (igual con los compases).
//   4. Compases de menos de medio compás: se quita su downbeat.
// Port en Python: repair_grid (worker/app/pipeline/chart.py).

/** Intervalos seguidos regulares que cuentan como pulso estable. */
const REGULAR_RUN = 4
/** Desvío máximo de un intervalo respecto a la mediana del tramo (fracción). */
const TOLERANCE = 0.2
/** Pulso plausible: 40–240 BPM. */
const MIN_BEAT_S = 0.25
const MAX_BEAT_S = 1.5
/** Intervalos con que se mide el pulso para extrapolar la intro. */
const STEP_SAMPLE = 8
/** Intervalos a cada lado para medir el pulso local. */
const LOCAL_WINDOW = 16
/** Un beat a menos de esta fracción del pulso local es un duplicado. */
const DUPLICATE_FRACTION = 0.6
/** Intervalos por debajo de esto no cuentan al medir el pulso local. */
const MIN_INTERVAL_S = 0.15
const DECIMALS = 1e4

const round = (t: number) => Math.round(t * DECIMALS) / DECIMALS

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const indexOfTime = (values: readonly number[], t: number) =>
  values.findIndex(v => Math.abs(v - t) <= TIME_EPSILON_S)

const intervalsOf = (beats: readonly number[]) => beats.slice(1).map((b, i) => b - beats[i])

/** Beats por compás más frecuente entre downbeats consecutivos. */
function beatsPerBar(beats: readonly number[], downbeats: readonly number[], fallback: number) {
  const counts = new Map<number, number>()
  for (let i = 1; i < downbeats.length; i++) {
    const n = indexOfTime(beats, downbeats[i]) - indexOfTime(beats, downbeats[i - 1])
    if (n >= 1 && n <= 32) counts.set(n, (counts.get(n) ?? 0) + 1)
  }
  let best = fallback
  let bestCount = 0
  for (const [n, c] of counts) {
    if (c > bestCount) [best, bestCount] = [n, c]
  }
  return best
}

/** Paso 1: intro sin pulso estable. */
function repairLeadIn(grid: ChartGrid, perBarFallback: number): ChartGrid {
  const { beats, downbeats } = grid
  const intervals = intervalsOf(beats)
  let k = -1
  let step = 0
  for (let i = 0; i + REGULAR_RUN <= intervals.length; i++) {
    const run = intervals.slice(i, i + REGULAR_RUN)
    const m = median(run)
    if (m >= MIN_BEAT_S && m <= MAX_BEAT_S && run.every(d => Math.abs(d - m) <= m * TOLERANCE)) {
      k = i
      step = median(
        intervals.slice(i, i + STEP_SAMPLE).filter(d => Math.abs(d - m) <= m * TOLERANCE),
      )
      break
    }
  }
  if (k <= 0) return grid

  const first = beats[k]
  const keptDown = downbeats.filter(d => d >= first - TIME_EPSILON_S)
  if (keptDown.length === 0) return grid

  const lead: number[] = []
  for (let t = first - step; t >= -TIME_EPSILON_S; t -= step) lead.unshift(round(Math.max(t, 0)))
  // Si el redondeo deja dos beats en 0 s, sobra el primero
  if (lead.length > 1 && lead[0] === lead[1]) lead.shift()
  const newBeats = [...lead, ...beats.slice(k)]

  const perBar = beatsPerBar(newBeats, keptDown, perBarFallback)
  const firstDown = indexOfTime(newBeats, keptDown[0])
  const leadDown: number[] = []
  for (let i = firstDown - perBar; i >= 0; i -= perBar) leadDown.unshift(newBeats[i])
  return { beats: newBeats, downbeats: [...leadDown, ...keptDown] }
}

/** Pulso local: mediana de los intervalos alrededor del beat i. */
function localBeatOf(intervals: readonly number[]) {
  return (i: number) => {
    const window = intervals
      .slice(Math.max(0, i - LOCAL_WINDOW), i + LOCAL_WINDOW)
      .filter(d => d >= MIN_INTERVAL_S)
    return window.length ? median(window) : median(intervals)
  }
}

/** Cada downbeat pasa al beat más cercano de `beats` (sin repetir). */
function snapDownbeats(beats: readonly number[], downbeats: readonly number[]): number[] {
  const out: number[] = []
  for (const d of downbeats) {
    let nearest = beats[0]
    for (const b of beats) if (Math.abs(b - d) < Math.abs(nearest - d)) nearest = b
    if (out.length === 0 || nearest > out[out.length - 1]) out.push(nearest)
  }
  return out
}

/**
 * Marca los elementos que están dentro de un tramo de al menos `run` huecos
 * seguidos que cumplen `ok` (el hueco i va del elemento i al i + 1).
 */
function stableMarks(gaps: number, ok: (i: number) => boolean, run: number): boolean[] {
  const stable = new Array<boolean>(gaps + 1).fill(false)
  let start = 0
  for (let i = 0; i <= gaps; i++) {
    if (i < gaps && ok(i)) continue
    if (i - start >= run) stable.fill(true, start, i + 1)
    start = i + 1
  }
  return stable
}

/**
 * Recorre los anclajes (elementos estables) y rehace con `fill` lo que hay entre
 * dos seguidos, o el hueco entre dos contiguos que no cumple `ok`; si `fill`
 * devuelve null, se deja lo original.
 */
function rebuildBetweenAnchors<T>(
  items: readonly T[],
  stable: readonly boolean[],
  ok: (i: number) => boolean,
  fill: (from: number, to: number) => T[] | null,
): T[] {
  const first = stable.indexOf(true)
  if (first < 0) return [...items]
  const out = items.slice(0, first + 1)
  let previous = first
  for (let j = first + 1; j < items.length; j++) {
    if (!stable[j]) continue
    if (j > previous + 1 || !ok(previous)) {
      out.push(...(fill(previous, j) ?? items.slice(previous + 1, j)))
    }
    out.push(items[j])
    previous = j
  }
  out.push(...items.slice(previous + 1))
  return out
}

/** Paso 2: beats duplicados (más juntos que DUPLICATE_FRACTION del pulso local). */
function removeDuplicateBeats(grid: ChartGrid): ChartGrid {
  const { beats } = grid
  const localBeat = localBeatOf(intervalsOf(beats))

  const kept: number[] = []
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]
    const last = kept[kept.length - 1]
    const local = localBeat(i)
    if (last === undefined || b - last >= local * DUPLICATE_FRACTION) {
      kept.push(b)
      continue
    }
    // Dos beats demasiado juntos: queda el que mejor sigue al anterior
    const before = kept[kept.length - 2]
    if (before !== undefined && Math.abs(b - before - local) < Math.abs(last - before - local)) {
      kept[kept.length - 1] = b
    }
  }
  if (kept.length === beats.length) return grid
  return { beats: kept, downbeats: snapDownbeats(kept, grid.downbeats) }
}

/**
 * Paso 3a: beats entre dos tramos estables. Si el hueco mide un número entero
 * de pulsos (± TOLERANCE), se rehacen equiespaciados; si no, quedan como están.
 */
function regularizeBeats(grid: ChartGrid): ChartGrid {
  const { beats } = grid
  const intervals = intervalsOf(beats)
  const localBeat = localBeatOf(intervals)
  const regular = (i: number) => Math.abs(intervals[i] - localBeat(i)) <= localBeat(i) * TOLERANCE
  const stable = stableMarks(intervals.length, regular, REGULAR_RUN)
  const rebuilt = rebuildBetweenAnchors(beats, stable, regular, (from, to) => {
    const a = beats[from]
    const b = beats[to]
    const step = (localBeat(from) + localBeat(to - 1)) / 2
    const n = Math.round((b - a) / step)
    if (n < 1 || Math.abs(b - a - n * step) > step * TOLERANCE) return null
    return Array.from({ length: n - 1 }, (_, k) => round(a + ((b - a) * (k + 1)) / n))
  })
  if (rebuilt.length === beats.length && rebuilt.every((b, i) => b === beats[i])) return grid
  return { beats: rebuilt, downbeats: snapDownbeats(rebuilt, grid.downbeats) }
}

/**
 * Paso 3b: lo mismo con los compases, contando en beats: entre dos tramos de
 * compases completos, si el hueco es un múltiplo del compás se rehace.
 */
function regularizeDownbeats(grid: ChartGrid, perBarFallback: number): ChartGrid {
  const { beats, downbeats } = grid
  const perBar = beatsPerBar(beats, downbeats, perBarFallback)
  const index = downbeats.map(d => indexOfTime(beats, d))
  const fullBar = (i: number) => index[i + 1] - index[i] === perBar
  // Dos compases completos seguidos bastan para anclar
  const stable = stableMarks(index.length - 1, fullBar, 2)
  const rebuilt = rebuildBetweenAnchors(index, stable, fullBar, (from, to) => {
    const gap = index[to] - index[from]
    if (gap % perBar !== 0) return null
    return Array.from({ length: gap / perBar - 1 }, (_, k) => index[from] + perBar * (k + 1))
  })
  if (rebuilt.length === index.length && rebuilt.every((v, i) => v === index[i])) return grid
  return { beats, downbeats: rebuilt.map(i => beats[i]) }
}

/** Paso 4: compases de medio compás o menos (se quita el downbeat que los empieza tarde). */
function removeShortMeasures(grid: ChartGrid, perBarFallback: number): ChartGrid {
  const { beats, downbeats } = grid
  const perBar = beatsPerBar(beats, downbeats, perBarFallback)
  const minBeats = Math.floor(perBar / 2) + 1
  const kept: number[] = []
  for (const d of downbeats) {
    const last = kept[kept.length - 1]
    if (last === undefined || indexOfTime(beats, d) - indexOfTime(beats, last) >= minBeats) {
      kept.push(d)
    }
  }
  return kept.length === downbeats.length ? grid : { beats, downbeats: kept }
}

/**
 * Rejilla reparada, o null si ya estaba bien. Rejillas con menos de
 * REGULAR_RUN + 2 beats no se tocan.
 */
export function repairGrid(grid: ChartGrid, perBarFallback = 4): ChartGrid | null {
  if (grid.beats.length < REGULAR_RUN + 2) return null
  const leadIn = repairLeadIn(grid, perBarFallback)
  const deduped = removeDuplicateBeats(leadIn)
  const regular = regularizeDownbeats(regularizeBeats(deduped), perBarFallback)
  const repaired = removeShortMeasures(regular, perBarFallback)
  return repaired === grid ? null : repaired
}

/**
 * Secciones renumeradas sobre la rejilla nueva (por tiempo: cada sección sigue
 * empezando y terminando en el mismo segundo). Descarta las vacías y los solapes.
 */
function remapSections(
  sections: readonly ChartSection[],
  oldGrid: ChartGrid,
  newGrid: ChartGrid,
  durationS: number,
): ChartSection[] {
  const old = oldGrid.downbeats
  const count = newGrid.downbeats.length
  const out: ChartSection[] = []
  let previousEnd = 0
  for (const s of sections) {
    const startS = old[s.startMeasure - 1]
    const endS = s.endMeasure < old.length ? old[s.endMeasure] : durationS
    const startMeasure = Math.max(measureAt(newGrid, startS), 1, previousEnd + 1)
    const endMeasure = Math.min(measureAt(newGrid, endS - 2 * TIME_EPSILON_S), count)
    if (endMeasure < startMeasure) continue
    out.push({ ...s, startMeasure, endMeasure })
    previousEnd = endMeasure
  }
  return out
}

/** Chart con la rejilla reparada (el mismo objeto si no hacía falta). */
export function repairChartGrid(chart: ChartV2): ChartV2 {
  const grid = repairGrid(chart.grid, chart.timeSignature[0])
  if (!grid) return chart
  return {
    ...chart,
    grid,
    sections: remapSections(chart.sections, chart.grid, grid, chart.durationS),
  }
}

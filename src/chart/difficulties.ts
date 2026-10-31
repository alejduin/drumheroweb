import { PIECES } from '@/types'
import type { ChartGrid, ChartNote, ChartV2, Piece } from '@/types'
import { CHORD_EPSILON_S } from '@/renderer/staffLayout'
import { beatPosition } from './grid'
import { noteDynamic } from './notes'

// ─── Dificultades automáticas (PLAN_V2 D1 / D13, REQUIREMENTS_V2 §7) ─────────
// Se derivan de `full` en el cliente, así se regeneran sin el worker al editar.
// Las notas conservan su tiempo original (no se recuantizan): solo se filtran o
// cambian de pieza, y el swing de la canción se mantiene.
//
// - Básico: bombo y caja en los tiempos (negras) + platillo de tiempo en negras.
// - Intermedio: todo en corcheas (rectas o de shuffle), sin ghost notes, y los
//   fills de toms pasan a la caja.

/** Tolerancia (en beats) para considerar que una nota cae en una posición. */
export const POSITION_TOLERANCE_BEATS = 0.06

/** Platillos que llevan el tiempo. */
const TIMEKEEPERS: ReadonlySet<Piece> = new Set(['hihat_closed', 'hihat_open', 'ride', 'crash'])
const TOMS: ReadonlySet<Piece> = new Set(['tom1', 'tom2', 'tom3'])

export type Subdivision = 'beat' | 'eighth' | 'fine'

/**
 * A qué subdivisión pertenece una posición en beats: el tiempo, una corchea (recta
 * en 1/2 o de shuffle en 2/3) o algo más fino (semicorcheas, tresillos completos).
 */
export function subdivisionOf(position: number): Subdivision {
  const frac = position - Math.floor(position)
  const near = (target: number) => Math.abs(frac - target) <= POSITION_TOLERANCE_BEATS
  if (near(0) || near(1)) return 'beat'
  if (near(0.5) || near(2 / 3)) return 'eighth'
  return 'fine'
}

/** Ordena como el worker (t, luego pieza) y deja una nota por pieza e instante: la más fuerte. */
function dedupe(notes: ChartNote[]): ChartNote[] {
  const order = (p: Piece) => PIECES.indexOf(p)
  const sorted = [...notes].sort((a, b) => a.t - b.t || order(a.piece) - order(b.piece))
  const result: ChartNote[] = []
  for (const note of sorted) {
    const twin = result.findLast(n => n.piece === note.piece && note.t - n.t <= CHORD_EPSILON_S)
    if (!twin) result.push(note)
    else if (note.velocity > twin.velocity) result[result.indexOf(twin)] = note
  }
  return result
}

function basicNote(note: ChartNote, level: Subdivision): ChartNote | null {
  if (level !== 'beat' || noteDynamic(note) === 'ghost') return null
  switch (note.piece) {
    case 'kick':
    case 'snare':
      return note
    case 'snare_rim':
      return { ...note, piece: 'snare' }
    // El hi-hat abierto se simplifica a cerrado; el pedal no se toca en Básico
    case 'hihat_open':
      return { ...note, piece: 'hihat_closed' }
    default:
      return TIMEKEEPERS.has(note.piece) ? note : null
  }
}

function intermediateNote(note: ChartNote, level: Subdivision): ChartNote | null {
  if (level === 'fine' || noteDynamic(note) === 'ghost') return null
  if (note.piece === 'hihat_pedal') return null
  if (TOMS.has(note.piece) || note.piece === 'snare_rim') return { ...note, piece: 'snare' }
  return note
}

/** Básico e Intermedio a partir de las notas completas. */
export function generateDifficulties(
  full: readonly ChartNote[],
  grid: ChartGrid,
): { basic: ChartNote[]; intermediate: ChartNote[] } {
  const basic: ChartNote[] = []
  const intermediate: ChartNote[] = []
  for (const note of full) {
    const level = subdivisionOf(beatPosition(grid, note.t))
    const b = basicNote(note, level)
    if (b) basic.push(b)
    const i = intermediateNote(note, level)
    if (i) intermediate.push(i)
  }
  return { basic: dedupe(basic), intermediate: dedupe(intermediate) }
}

/** El chart con Básico e Intermedio regenerados desde `full`. */
export function withGeneratedDifficulties(chart: ChartV2): ChartV2 {
  const { full } = chart.difficulties
  const { basic, intermediate } = generateDifficulties(full.notes, chart.grid)
  return {
    ...chart,
    difficulties: { basic: { notes: basic }, intermediate: { notes: intermediate }, full },
  }
}

/**
 * El chart listo para jugar en cualquier dificultad: si Básico e Intermedio
 * vienen vacíos (el worker solo emite `full`), se generan.
 */
export function ensureDifficulties(chart: ChartV2): ChartV2 {
  const { basic, intermediate, full } = chart.difficulties
  if (!full.notes.length || (basic.notes.length && intermediate.notes.length)) return chart
  return withGeneratedDifficulties(chart)
}

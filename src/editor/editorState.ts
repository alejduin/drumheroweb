import { PIECES } from '@/types'
import type { ChartGrid, ChartNote, ChartV2, Piece } from '@/types'
import { measureRange, timeToMeasureBeat } from '@/chart/grid'
import { needsReview } from '@/chart/notes'
import { CHORD_EPSILON_S } from '@/renderer/staffLayout'
import { DEFAULT_DIVISION, roundTime, snapTime } from './quantize'
import type { Division } from './quantize'
import type { RecordedHit } from './recording'

// ─── Estado del editor de partitura (PLAN_V2 C3) ─────────────────────────────
// Reducer puro sobre las notas de la dificultad completa. Cada nota lleva un id
// estable (la selección sobrevive a reordenar); el id no se guarda en el chart.

export interface EditorNote extends ChartNote {
  id: number
}

/** Pasos de deshacer que se guardan. */
export const HISTORY_LIMIT = 100
/** Nota nueva: golpe normal, ya revisada. */
export const NEW_NOTE_VELOCITY = 96
export const REVIEWED_CONFIDENCE = 1

export interface EditorState {
  readonly grid: ChartGrid
  readonly durationS: number
  notes: readonly EditorNote[]
  /** Ids seleccionados. */
  selection: readonly number[]
  division: Division
  past: ReadonlyArray<readonly EditorNote[]>
  future: ReadonlyArray<readonly EditorNote[]>
  /** Notas de la última vez que se guardó (para saber si hay cambios). */
  saved: readonly EditorNote[]
  nextId: number
}

export type EditorAction =
  | { type: 'select'; ids: readonly number[]; additive?: boolean }
  | { type: 'setDivision'; division: Division }
  | { type: 'add'; t: number; piece: Piece }
  | { type: 'delete' }
  | { type: 'move'; steps: number }
  | { type: 'setPiece'; piece: Piece }
  /** Marca la selección como revisada (confianza 1) sin cambiarla. */
  | { type: 'confirm' }
  | { type: 'confirmAll' }
  | { type: 'requantize'; fromMeasure: number; toMeasure: number; division: Division }
  /** Los golpes grabados con el kit reemplazan las notas de esos compases (C5). */
  | { type: 'replaceRange'; fromMeasure: number; toMeasure: number; hits: readonly RecordedHit[] }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saved' }

export function createEditorState(chart: ChartV2): EditorState {
  const notes = chart.difficulties.full.notes.map((n, i) => ({ ...n, id: i + 1 }))
  return {
    grid: chart.grid,
    durationS: chart.durationS,
    notes,
    selection: [],
    division: DEFAULT_DIVISION,
    past: [],
    future: [],
    saved: notes,
    nextId: notes.length + 1,
  }
}

export const isDirty = (state: EditorState) => state.notes !== state.saved
export const canUndo = (state: EditorState) => state.past.length > 0
export const canRedo = (state: EditorState) => state.future.length > 0

const pieceOrder = (piece: Piece) => PIECES.indexOf(piece)

/**
 * Ordena por tiempo y quita duplicados (misma pieza en el mismo instante). Gana la
 * nota recién editada (`keep`); si no, la de más confianza.
 */
export function normalizeNotes(
  notes: readonly EditorNote[],
  keep: ReadonlySet<number> = new Set(),
): EditorNote[] {
  const sorted = [...notes].sort((a, b) => a.t - b.t || pieceOrder(a.piece) - pieceOrder(b.piece))
  const result: EditorNote[] = []
  for (const note of sorted) {
    const twin = result.findLast(n => n.piece === note.piece && note.t - n.t <= CHORD_EPSILON_S)
    if (!twin) {
      result.push(note)
      continue
    }
    const preferNew =
      (keep.has(note.id) && !keep.has(twin.id)) ||
      (keep.has(note.id) === keep.has(twin.id) && note.confidence > twin.confidence)
    if (preferNew) result[result.indexOf(twin)] = note
  }
  return result
}

/** Aplica un cambio de notas guardando el estado anterior para deshacer. */
function commit(
  state: EditorState,
  notes: EditorNote[],
  patch: Partial<EditorState> = {},
): EditorState {
  const ids = new Set(notes.map(n => n.id))
  return {
    ...state,
    ...patch,
    notes,
    selection: (patch.selection ?? state.selection).filter(id => ids.has(id)),
    past: [...state.past, state.notes].slice(-HISTORY_LIMIT),
    future: [],
  }
}

/** Cambia las notas seleccionadas (y las marca como revisadas). */
function editSelection(state: EditorState, edit: (note: EditorNote) => EditorNote): EditorState {
  if (!state.selection.length) return state
  const selected = new Set(state.selection)
  const notes = state.notes.map(n =>
    selected.has(n.id) ? { ...edit(n), confidence: REVIEWED_CONFIDENCE } : n,
  )
  return commit(state, normalizeNotes(notes, selected))
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'select': {
      if (!action.additive) return { ...state, selection: [...action.ids] }
      // Con Mayús se suma o se quita de la selección
      const selection = new Set(state.selection)
      for (const id of action.ids) {
        if (selection.has(id)) selection.delete(id)
        else selection.add(id)
      }
      return { ...state, selection: [...selection] }
    }
    case 'setDivision':
      return { ...state, division: action.division }
    case 'add': {
      const t = snapTime(state.grid, action.t, state.division, state.durationS)
      const note: EditorNote = {
        id: state.nextId,
        t,
        tRaw: t,
        piece: action.piece,
        velocity: NEW_NOTE_VELOCITY,
        confidence: REVIEWED_CONFIDENCE,
      }
      return commit(state, normalizeNotes([...state.notes, note], new Set([note.id])), {
        nextId: state.nextId + 1,
        selection: [note.id],
      })
    }
    case 'delete': {
      if (!state.selection.length) return state
      const selected = new Set(state.selection)
      return commit(
        state,
        state.notes.filter(n => !selected.has(n.id)),
        { selection: [] },
      )
    }
    case 'move':
      return editSelection(state, n => ({
        ...n,
        t: snapTime(state.grid, n.t, state.division, state.durationS, action.steps),
      }))
    case 'setPiece':
      return editSelection(state, n => ({ ...n, piece: action.piece }))
    case 'confirm':
      return editSelection(state, n => n)
    case 'confirmAll': {
      if (!state.notes.some(needsReview)) return state
      return commit(
        state,
        state.notes.map(n => (needsReview(n) ? { ...n, confidence: REVIEWED_CONFIDENCE } : n)),
      )
    }
    case 'requantize': {
      const { startS } = measureRange(state.grid, action.fromMeasure, state.durationS)
      const { endS } = measureRange(state.grid, action.toMeasure, state.durationS)
      // Desde el onset sin cuantizar (tRaw) cuando existe
      const notes = state.notes.map(n => {
        const source = n.tRaw ?? n.t
        if (n.t < startS || n.t >= endS) return n
        return { ...n, t: snapTime(state.grid, source, action.division, state.durationS) }
      })
      return commit(state, normalizeNotes(notes))
    }
    case 'replaceRange': {
      const { startS } = measureRange(state.grid, action.fromMeasure, state.durationS)
      const { endS } = measureRange(state.grid, action.toMeasure, state.durationS)
      const inRange = (t: number) => t >= startS && t < endS
      // Se cuantiza primero: un golpe un poco antes del compás cae en su primer tiempo
      const recorded: EditorNote[] = []
      for (const hit of action.hits) {
        const t = snapTime(state.grid, hit.t, state.division, state.durationS)
        if (!inRange(t)) continue
        recorded.push({
          id: state.nextId + recorded.length,
          t,
          tRaw: roundTime(hit.t),
          piece: hit.piece,
          velocity: Math.min(Math.max(Math.round(hit.velocity), 1), 127),
          confidence: REVIEWED_CONFIDENCE,
        })
      }
      const kept = state.notes.filter(n => !inRange(n.t))
      // Un doble disparo del pad (misma pieza en la misma casilla) queda en una nota
      return commit(state, normalizeNotes([...kept, ...recorded]), {
        nextId: state.nextId + recorded.length,
        selection: [],
      })
    }
    case 'undo': {
      const previous = state.past[state.past.length - 1]
      if (!previous) return state
      return {
        ...state,
        notes: previous,
        past: state.past.slice(0, -1),
        future: [state.notes, ...state.future],
        selection: keepExisting(state.selection, previous),
      }
    }
    case 'redo': {
      const [next, ...rest] = state.future
      if (!next) return state
      return {
        ...state,
        notes: next,
        past: [...state.past, state.notes],
        future: rest,
        selection: keepExisting(state.selection, next),
      }
    }
    case 'saved':
      return { ...state, saved: state.notes }
  }
}

function keepExisting(selection: readonly number[], notes: readonly EditorNote[]): number[] {
  const ids = new Set(notes.map(n => n.id))
  return selection.filter(id => ids.has(id))
}

/** El chart con las notas editadas (sin ids, tiempos redondeados como el worker). */
export function chartWithEdits(chart: ChartV2, state: EditorState): ChartV2 {
  // Las dificultades Básico e Intermedio se regeneran desde `full` cuando exista D13
  const notes = state.notes.map(note => {
    const plain: ChartNote & { id?: number } = { ...note, t: roundTime(note.t) }
    delete plain.id
    return plain as ChartNote
  })
  return { ...chart, difficulties: { ...chart.difficulties, full: { notes } } }
}

export interface ReviewItem {
  id: number
  t: number
  piece: Piece
  measure: number
  beat: number
  confidence: number
}

/** Notas por revisar (confianza baja), en orden. */
export function reviewItems(state: EditorState): ReviewItem[] {
  return state.notes.filter(needsReview).map(n => {
    const { measure, beat } = timeToMeasureBeat(state.grid, n.t)
    return { id: n.id, t: n.t, piece: n.piece, measure, beat, confidence: n.confidence }
  })
}

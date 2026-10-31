import { describe, expect, it } from 'vitest'
import type { ChartNote, ChartV2 } from '@/types'
import { chartIssues } from '@/chart/ChartParser'
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  chartWithEdits,
  createEditorState,
  editorReducer,
  isDirty,
  reviewItems,
} from '@/editor/editorState'
import type { EditorAction, EditorState } from '@/editor/editorState'
import { analyzedChart } from '../fakes/FakeWorkerClient'

// Rejilla a 120 BPM (beat = 0,5 s), compases de 4 tiempos, 8 s
const beats = Array.from({ length: 17 }, (_, i) => i * 0.5)
const note = (
  t: number,
  piece: ChartNote['piece'],
  confidence = 0.9,
  tRaw?: number,
): ChartNote => ({
  t,
  piece,
  velocity: 90,
  confidence,
  ...(tRaw === undefined ? {} : { tRaw }),
})

function chartWith(notes: ChartNote[]): ChartV2 {
  const base = analyzedChart()
  return {
    ...base,
    durationS: 8,
    audioSha256: 'a'.repeat(64),
    grid: { beats, downbeats: [0, 2, 4, 6] },
    sections: [],
    difficulties: { ...base.difficulties, full: { notes } },
  }
}

const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, state)
const summary = (state: EditorState) => state.notes.map(n => `${n.t}:${n.piece}`)

const CHART = chartWith([note(0, 'kick'), note(0.5, 'snare', 0.4), note(1, 'kick', 0.3, 1.04)])
const ids = (state: EditorState, ...indices: number[]) => indices.map(i => state.notes[i].id)

describe('editor de partitura', () => {
  it('arranca con las notas del chart completo, sin cambios', () => {
    const state = createEditorState(CHART)
    expect(summary(state)).toEqual(['0:kick', '0.5:snare', '1:kick'])
    expect(isDirty(state)).toBe(false)
    expect(canUndo(state)).toBe(false)
  })

  it('agrega una nota cuantizada, revisada y seleccionada', () => {
    const state = run(createEditorState(CHART), { type: 'add', t: 0.76, piece: 'hihat_closed' })
    expect(summary(state)).toEqual(['0:kick', '0.5:snare', '0.75:hihat_closed', '1:kick'])
    const added = state.notes[2]
    expect(added).toMatchObject({ confidence: 1, tRaw: 0.75 })
    expect(state.selection).toEqual([added.id])
    expect(isDirty(state)).toBe(true)
  })

  it('agregar una pieza que ya está en ese instante no duplica', () => {
    const state = run(createEditorState(CHART), { type: 'add', t: 0.01, piece: 'kick' })
    expect(summary(state)).toEqual(['0:kick', '0.5:snare', '1:kick'])
  })

  it('borra la selección', () => {
    const start = createEditorState(CHART)
    const state = run(start, { type: 'select', ids: ids(start, 0, 2) }, { type: 'delete' })
    expect(summary(state)).toEqual(['0.5:snare'])
    expect(state.selection).toEqual([])
  })

  it('mueve por casillas de la subdivisión y reordena', () => {
    const start = createEditorState(CHART)
    const state = run(
      start,
      { type: 'select', ids: ids(start, 1) },
      { type: 'setDivision', division: 2 },
      { type: 'move', steps: 6 },
    )
    expect(summary(state)).toEqual(['0:kick', '1:kick', '2:snare'])
    // La nota editada queda revisada
    expect(state.notes[2].confidence).toBe(1)
  })

  it('mover encima de la misma pieza conserva la nota movida', () => {
    const start = createEditorState(CHART)
    const moved = ids(start, 0)[0]
    const state = run(
      start,
      { type: 'select', ids: [moved] },
      { type: 'setDivision', division: 2 },
      { type: 'move', steps: 4 },
    )
    expect(summary(state)).toEqual(['0.5:snare', '1:kick'])
    expect(state.notes[1].id).toBe(moved)
  })

  it('cambia la pieza y confirma notas dudosas', () => {
    const start = createEditorState(CHART)
    const state = run(
      start,
      { type: 'select', ids: ids(start, 1) },
      { type: 'setPiece', piece: 'tom1' },
    )
    expect(summary(state)).toEqual(['0:kick', '0.5:tom1', '1:kick'])
    expect(reviewItems(state).map(r => r.piece)).toEqual(['kick'])

    const confirmed = run(start, { type: 'select', ids: ids(start, 2) }, { type: 'confirm' })
    expect(summary(confirmed)).toEqual(summary(start))
    expect(reviewItems(confirmed).map(r => r.piece)).toEqual(['snare'])
    expect(reviewItems(run(start, { type: 'confirmAll' }))).toEqual([])
  })

  it('selección con Mayús suma y quita', () => {
    const start = createEditorState(CHART)
    const [a, b] = ids(start, 0, 1)
    const state = run(
      start,
      { type: 'select', ids: [a] },
      { type: 'select', ids: [b], additive: true },
      { type: 'select', ids: [a], additive: true },
    )
    expect(state.selection).toEqual([b])
  })

  it('recuantiza un rango de compases desde tRaw', () => {
    const chart = chartWith([
      note(0.25, 'snare', 0.9, 0.31),
      note(1, 'kick', 0.3, 1.04),
      note(2.25, 'snare', 0.9, 2.31),
    ])
    // Compás 1 (0–2 s) a tresillos de corchea: 0,31 → 0,3333 y 1,04 → 1
    const state = run(createEditorState(chart), {
      type: 'requantize',
      fromMeasure: 1,
      toMeasure: 1,
      division: 3,
    })
    expect(summary(state)).toEqual(['0.3333:snare', '1:kick', '2.25:snare'])
  })

  it('deshacer y rehacer', () => {
    const start = createEditorState(CHART)
    const added = run(start, { type: 'add', t: 3, piece: 'crash' })
    const undone = run(added, { type: 'undo' })
    expect(summary(undone)).toEqual(summary(start))
    expect(isDirty(undone)).toBe(false)
    expect(canRedo(undone)).toBe(true)
    expect(summary(run(undone, { type: 'redo' }))).toEqual(summary(added))
    // Un cambio nuevo descarta lo que se podía rehacer
    expect(canRedo(run(undone, { type: 'add', t: 4, piece: 'kick' }))).toBe(false)
    // Sin historial no hace nada
    expect(run(start, { type: 'undo' })).toBe(start)
  })

  it('el historial tiene un límite', () => {
    let state = createEditorState(CHART)
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      state = run(state, { type: 'add', t: (i % 15) * 0.5 + 0.25, piece: 'hihat_closed' })
    }
    expect(state.past).toHaveLength(HISTORY_LIMIT)
  })

  it('guardar marca el estado como limpio', () => {
    const state = run(
      createEditorState(CHART),
      { type: 'add', t: 3, piece: 'crash' },
      { type: 'saved' },
    )
    expect(isDirty(state)).toBe(false)
  })

  it('lista por revisar con compás y tiempo', () => {
    expect(reviewItems(createEditorState(CHART))).toEqual([
      expect.objectContaining({ piece: 'snare', measure: 1, beat: 2, confidence: 0.4 }),
      expect.objectContaining({ piece: 'kick', measure: 1, beat: 3, confidence: 0.3 }),
    ])
  })

  it('el chart editado es válido contra el schema y sin ids', () => {
    const start = createEditorState(CHART)
    const state = run(
      start,
      { type: 'add', t: 5.13, piece: 'ride' },
      { type: 'select', ids: ids(start, 0) },
      { type: 'delete' },
    )
    const chart = chartWithEdits(CHART, state)
    expect(chartIssues(chart)).toEqual([])
    expect(chart.difficulties.full.notes.some(n => 'id' in n)).toBe(false)
    expect(chart.difficulties.full.notes.map(n => n.t)).toEqual([0.5, 1, 5.125])
  })
})

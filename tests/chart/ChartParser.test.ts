import { describe, expect, it } from 'vitest'
import exampleJson from '@shared/examples/chart-v2.example.json'
import type { ChartV2 } from '@/types'
import { ChartParseError, chartIssues, parseChart } from '@/chart/ChartParser'

const v1Files = import.meta.glob('/tests/fixtures/v1/*.json', { eager: true, import: 'default' })

function example(): ChartV2 {
  return structuredClone(exampleJson) as ChartV2
}

function parseError(raw: unknown): ChartParseError {
  try {
    parseChart(raw)
  } catch (e) {
    if (e instanceof ChartParseError) return e
    throw e
  }
  throw new Error('parseChart no lanzó')
}

describe('parseChart', () => {
  it('acepta el chart v2 de ejemplo tal cual', () => {
    const raw = example()
    expect(parseChart(raw)).toEqual(raw)
  })

  it('rechaza lo que no es un chart', () => {
    for (const raw of [null, 42, 'chart', [], {}]) {
      expect(() => parseChart(raw)).toThrow(ChartParseError)
    }
  })

  it('reporta errores de schema con ruta legible', () => {
    const raw = example()
    Object.assign(raw.difficulties.full.notes[0], { piece: 'cowbell' })
    const error = parseError(raw)
    expect(error.issues.some(i => i.path === 'difficulties.full.notes.0.piece')).toBe(true)
    expect(error.message).toMatch(/^chart inválido: difficulties\.full\.notes\.0\.piece/)
  })

  it('reporta las invariantes que el schema no cubre', () => {
    const raw = example()
    const notes = raw.difficulties.full.notes
    notes[0].t = notes[1].t + 0.01 // la primera queda después de la segunda
    expect(chartIssues(raw)).toContainEqual({
      path: 'difficulties.full.notes[1]',
      message: 'las notas deben estar ordenadas por t',
    })
  })

  it('convierte los charts v1 al vuelo', () => {
    const [v1] = Object.values(v1Files)
    const chart = parseChart(v1)
    expect(chart.version).toBe(2)
    expect(chart.source.kind).toBe('builtin')
  })

  it('un v1 con datos inválidos da ChartParseError, no otro error', () => {
    const error = parseError({ id: 'x', title: 'x', bpm: -1, measures: [] })
    expect(error.issues[0].message).toMatch(/bpm inválido/)
  })
})

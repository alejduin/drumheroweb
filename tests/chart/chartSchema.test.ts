import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import exampleJson from '@shared/examples/chart-v2.example.json'
import schema from '@shared/chart-v2.schema.json'
import { CHART_SOURCE_KINDS, DIFFICULTIES, DYNAMICS, PIECES } from '@/types'
import type { ChartV2 } from '@/types'
import { validateChartInvariants } from '@/chart/invariants'

const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
const validate = ajv.compile(schema)

/** Copia profunda del ejemplo para mutarla en cada caso. */
function example(): ChartV2 {
  return structuredClone(exampleJson) as ChartV2
}

function schemaErrors(data: unknown): string[] {
  validate(data)
  return (validate.errors ?? []).map(e => `${e.instancePath} ${e.message}`)
}

// ─── Schema ───────────────────────────────────────────────────────────────────

describe('chart-v2.schema.json', () => {
  it('acepta el ejemplo válido', () => {
    expect(schemaErrors(example())).toEqual([])
  })

  it('acepta stems, audio y sha256 nulos (chart aún sin audio)', () => {
    const chart = { ...example(), stems: null, audioUrl: null, audioSha256: null }
    expect(schemaErrors(chart)).toEqual([])
  })

  it('acepta difficulties vacías en basic e intermediate (las genera el cliente)', () => {
    const chart = example()
    chart.difficulties.basic.notes = []
    chart.difficulties.intermediate.notes = []
    expect(schemaErrors(chart)).toEqual([])
  })

  const invalidCases: [string, (c: Record<string, unknown> & ChartV2) => void][] = [
    ['version distinta de 2', c => Object.assign(c, { version: 1 })],
    ['campo requerido ausente', c => delete (c as Partial<ChartV2>).grid],
    ['propiedad desconocida', c => Object.assign(c, { foo: 1 })],
    ['bpm cero', c => Object.assign(c, { bpm: 0 })],
    ['denominador de compás inválido', c => Object.assign(c, { timeSignature: [4, 3] })],
    ['compás con 3 elementos', c => Object.assign(c, { timeSignature: [4, 4, 4] })],
    ['id con espacios', c => Object.assign(c, { id: 'mi cancion' })],
    ['sha256 mal formado', c => Object.assign(c, { audioSha256: 'xyz' })],
    ['stems incompletos', c => Object.assign(c, { stems: { drums: 'a.ogg' } })],
    ['grid sin beats', c => Object.assign(c, { grid: { beats: [], downbeats: [0] } })],
    ['falta una dificultad', c => delete (c.difficulties as Partial<ChartV2['difficulties']>).full],
    ['pieza desconocida', c => Object.assign(c.difficulties.full.notes[0], { piece: 'cowbell' })],
    [
      'pieza v1 ride_edge',
      c => Object.assign(c.difficulties.full.notes[0], { piece: 'ride_edge' }),
    ],
    ['velocity 0', c => Object.assign(c.difficulties.full.notes[0], { velocity: 0 })],
    ['velocity 128', c => Object.assign(c.difficulties.full.notes[0], { velocity: 128 })],
    ['velocity decimal', c => Object.assign(c.difficulties.full.notes[0], { velocity: 64.5 })],
    ['confidence > 1', c => Object.assign(c.difficulties.full.notes[0], { confidence: 1.2 })],
    ['t negativo', c => Object.assign(c.difficulties.full.notes[0], { t: -0.1 })],
    ['dynamic desconocida', c => Object.assign(c.difficulties.full.notes[0], { dynamic: 'loud' })],
    ['nota con campo extra', c => Object.assign(c.difficulties.full.notes[0], { midi: 36 })],
    ['sección con compás 0', c => Object.assign(c.sections[0], { startMeasure: 0 })],
    ['source.kind desconocido', c => Object.assign(c.source, { kind: 'scraped' })],
    ['createdAt no es fecha', c => Object.assign(c.source, { createdAt: 'ayer' })],
  ]

  it.each(invalidCases)('rechaza: %s', (_name, mutate) => {
    const chart = example() as Record<string, unknown> & ChartV2
    mutate(chart)
    expect(schemaErrors(chart).length).toBeGreaterThan(0)
  })
})

// ─── Paridad schema ↔ TypeScript ──────────────────────────────────────────────

describe('paridad schema ↔ tipos TS', () => {
  it('las piezas coinciden', () => {
    expect(schema.$defs.piece.enum).toEqual([...PIECES])
  })

  it('las dinámicas coinciden', () => {
    expect(schema.$defs.note.properties.dynamic.enum).toEqual([...DYNAMICS])
  })

  it('las dificultades coinciden', () => {
    expect(schema.properties.difficulties.required).toEqual([...DIFFICULTIES])
  })

  it('los tipos de origen coinciden', () => {
    expect(schema.properties.source.properties.kind.enum).toEqual([...CHART_SOURCE_KINDS])
  })

  it('un ChartV2 construido en TS pasa el schema', () => {
    const chart: ChartV2 = {
      version: 2,
      id: 'ts-built',
      title: 'Construido en TS',
      artist: '',
      bpm: 120,
      timeSignature: [4, 4],
      durationS: 2,
      audioUrl: null,
      stems: null,
      audioSha256: null,
      youtubeUrl: null,
      youtubeOffsetMs: 0,
      grid: { beats: [0, 0.5, 1, 1.5], downbeats: [0] },
      difficulties: {
        basic: { notes: [] },
        intermediate: { notes: [] },
        full: { notes: [{ t: 0, piece: 'tom3', velocity: 100, confidence: 1 }] },
      },
      sections: [],
      source: { kind: 'manual', createdAt: '2026-10-23T00:00:00.000Z' },
    }
    expect(schemaErrors(chart)).toEqual([])
    expect(validateChartInvariants(chart)).toEqual([])
  })
})

// ─── Invariantes ──────────────────────────────────────────────────────────────

describe('validateChartInvariants', () => {
  it('el ejemplo no tiene problemas', () => {
    expect(validateChartInvariants(example())).toEqual([])
  })

  it('acepta notas simultáneas (mismo t)', () => {
    const chart = example()
    const notes = chart.difficulties.full.notes
    expect(notes.some((n, i) => i > 0 && n.t === notes[i - 1].t)).toBe(true)
    expect(validateChartInvariants(chart)).toEqual([])
  })

  it('detecta notas desordenadas', () => {
    const chart = example()
    chart.difficulties.full.notes.reverse()
    const issues = validateChartInvariants(chart)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0].path).toMatch(/^difficulties\.full\.notes\[\d+\]$/)
  })

  it('detecta una nota después de durationS', () => {
    const chart = example()
    chart.difficulties.basic.notes.push({ t: 99, piece: 'kick', velocity: 90, confidence: 1 })
    expect(validateChartInvariants(chart)).toContainEqual({
      path: `difficulties.basic.notes[${chart.difficulties.basic.notes.length - 1}]`,
      message: 'la nota está después de durationS',
    })
  })

  it('detecta tRaw después de durationS', () => {
    const chart = example()
    chart.difficulties.full.notes[0].tRaw = 99
    expect(validateChartInvariants(chart).map(i => i.message)).toContain(
      'tRaw está después de durationS',
    )
  })

  it('tolera redondeo en el borde de durationS', () => {
    const chart = example()
    const last = chart.difficulties.full.notes.at(-1)!
    chart.durationS = last.t - 0.0001
    expect(validateChartInvariants(chart)).toEqual([])
  })

  it('detecta beats no ascendentes', () => {
    const chart = example()
    chart.grid.beats[3] = chart.grid.beats[2]
    expect(validateChartInvariants(chart).map(i => i.path)).toContain('grid.beats[3]')
  })

  it('detecta un downbeat que no es beat', () => {
    const chart = example()
    chart.grid.downbeats[1] += 0.1
    expect(validateChartInvariants(chart).map(i => i.path)).toContain('grid.downbeats[1]')
  })

  it('detecta beats después de durationS', () => {
    const chart = example()
    chart.grid.beats.push(chart.durationS + 1)
    expect(validateChartInvariants(chart).map(i => i.path)).toContain('grid.beats')
  })

  it('detecta secciones invertidas, solapadas o fuera de rango', () => {
    const chart = example()
    chart.sections = [
      { name: 'A', startMeasure: 2, endMeasure: 1 },
      { name: 'B', startMeasure: 2, endMeasure: 2 },
      { name: 'C', startMeasure: 3, endMeasure: 9 },
    ]
    const messages = validateChartInvariants(chart).map(i => `${i.path}: ${i.message}`)
    expect(messages).toEqual([
      'sections[0]: endMeasure debe ser >= startMeasure',
      'sections[1]: las secciones deben estar ordenadas y sin solaparse',
      'sections[2]: la sección termina después del último compás (3)',
    ])
  })
})

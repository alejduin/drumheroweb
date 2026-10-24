import { describe, expect, it } from 'vitest'
import type { ChartGrid } from '@/types'
import {
  AUTO_SECTION_MEASURES,
  PRACTICE_TEMPO,
  effectiveSections,
  practiceSuggestion,
  rulerLabel,
  sectionIndexAt,
  sectionSpans,
} from '@/game/sections'
import type { SectionStats } from '@/scoring/ScoreManager'

// 20 compases de 2 s, empezando en 0
const grid: ChartGrid = {
  beats: Array.from({ length: 80 }, (_, i) => i * 0.5),
  downbeats: Array.from({ length: 20 }, (_, i) => i * 2),
}
const SECTIONS = [
  { name: 'Intro', startMeasure: 1, endMeasure: 4 },
  { name: 'Verso', startMeasure: 5, endMeasure: 12 },
  { name: 'Coro', startMeasure: 13, endMeasure: 20 },
]

const stat = (name: string, precision: number | null, start = 1, end = 4): SectionStats => ({
  name,
  startMeasure: start,
  endMeasure: end,
  tally: { perfect: 0, close: 0, miss: 0 },
  precision,
})

describe('secciones', () => {
  it('usa las del chart si las trae', () => {
    expect(effectiveSections({ sections: SECTIONS, grid })).toBe(SECTIONS)
  })

  it('sin secciones, bloques automáticos que cubren todos los compases', () => {
    const auto = effectiveSections({ sections: [], grid })
    expect(AUTO_SECTION_MEASURES).toBe(8)
    expect(auto).toEqual([
      { name: 'Compases 1–8', startMeasure: 1, endMeasure: 8 },
      { name: 'Compases 9–16', startMeasure: 9, endMeasure: 16 },
      { name: 'Compases 17–20', startMeasure: 17, endMeasure: 20 },
    ])
  })

  it('sección actual por compás', () => {
    expect(sectionIndexAt(SECTIONS, 0)).toBe(-1)
    expect(sectionIndexAt(SECTIONS, 4)).toBe(0)
    expect(sectionIndexAt(SECTIONS, 5)).toBe(1)
    expect(sectionIndexAt(SECTIONS, 20)).toBe(2)
    expect(sectionIndexAt(SECTIONS, 21)).toBe(-1)
  })

  it('regla: fracción de la canción de cada sección; la última termina en durationS', () => {
    const spans = sectionSpans(SECTIONS, grid, 40)
    expect(spans).toEqual([
      { name: 'Intro', start: 0, end: 0.2 },
      { name: 'Verso', start: 0.2, end: 0.6 },
      { name: 'Coro', start: 0.6, end: 1 },
    ])
    expect(sectionSpans(SECTIONS, grid, 0)).toEqual([])
    const auto = effectiveSections({ sections: [], grid })
    expect(sectionSpans(auto, grid, 40, s => rulerLabel(s, true)).map(s => s.name)).toEqual([
      '1',
      '9',
      '17',
    ])
  })

  it('sugiere practicar la sección tocada más floja por debajo del 85 %', () => {
    expect(
      practiceSuggestion([
        stat('Intro', 0.98),
        stat('Verso', 0.76, 5, 12),
        stat('Puente', 0.8, 13, 16),
        stat('Coro', null, 17, 20),
      ]),
    ).toEqual({ startMeasure: 5, endMeasure: 12, tempo: PRACTICE_TEMPO })
    expect(practiceSuggestion([stat('Intro', 0.9), stat('Verso', null)])).toBeNull()
  })
})

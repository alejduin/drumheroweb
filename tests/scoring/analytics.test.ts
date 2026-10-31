import { describe, expect, it } from 'vitest'
import { STAR_THRESHOLDS, starsFor } from '@/constants/scoring'
import {
  WEAK_MIN_NOTES,
  buildHeadline,
  distributionOf,
  findWeakestMeasures,
  measureBars,
  measureSpans,
  timingTendency,
} from '@/scoring/analytics'
import type { SectionPrecision } from '@/scoring/analytics'
import type { MeasureStats, Tally } from '@/scoring/ScoreManager'
import { precisionOf } from '@/scoring/ScoreManager'
import type { PieceGroup } from '@/scoring/pieceGroups'

/** Compás con `hits` aciertos y `misses` fallos; por defecto todo en la caja. */
function measure(
  n: number,
  hits: number,
  misses: number,
  byGroup?: Partial<Record<PieceGroup, Tally>>,
): MeasureStats {
  const tally = { perfect: hits, close: 0, miss: misses }
  return { measure: n, tally, precision: precisionOf(tally), byGroup: byGroup ?? { snare: tally } }
}

/** Compases 1…n perfectos (8 notas cada uno). */
const perfectSong = (n: number) => Array.from({ length: n }, (_, i) => measure(i + 1, 8, 0))

describe('findWeakestMeasures', () => {
  it('sin compases débiles no propone nada', () => {
    expect(findWeakestMeasures(perfectSong(16))).toBeNull()
    expect(findWeakestMeasures([])).toBeNull()
  })

  it('encuentra el tramo de 4 compases con menor precisión y su pieza más floja', () => {
    const song = perfectSong(16)
    song[9] = measure(10, 4, 4, {
      kick: { perfect: 4, close: 0, miss: 0 },
      toms: { perfect: 0, close: 0, miss: 4 },
    })
    song[10] = measure(11, 2, 6)
    song[11] = measure(12, 3, 5)
    const weak = findWeakestMeasures(song)
    expect(weak).toMatchObject({ startMeasure: 9, endMeasure: 12 })
    // compases 9–12: 8 + 4 + 2 + 3 = 17 de 32
    expect(weak?.precision).toBeCloseTo(17 / 32)
    expect(weak?.group).toBe('toms')
  })

  it('a igualdad de precisión gana el primer tramo', () => {
    const song = perfectSong(12)
    song[1] = measure(2, 0, 8)
    song[9] = measure(10, 0, 8)
    expect(findWeakestMeasures(song)).toMatchObject({ startMeasure: 1, endMeasure: 4 })
  })

  it('recorta los bordes a compases con notas (silencios no se proponen)', () => {
    // compases 1–2 perfectos, 3–5 en silencio, 6 todo fallo: el tramo 3–6 queda en 6–6
    const song = [...perfectSong(2), measure(6, 0, 8)]
    expect(findWeakestMeasures(song)).toMatchObject({ startMeasure: 6, endMeasure: 6 })
  })

  it('ignora tramos con menos de WEAK_MIN_NOTES notas evaluadas', () => {
    const sparse = [measure(1, 0, WEAK_MIN_NOTES - 1)]
    expect(findWeakestMeasures(sparse)).toBeNull()
    expect(findWeakestMeasures([measure(1, 0, WEAK_MIN_NOTES)])).toMatchObject({
      startMeasure: 1,
      endMeasure: 1,
      precision: 0,
    })
  })

  it('una canción más corta que el tramo se evalúa entera', () => {
    const song = [measure(1, 8, 0), measure(2, 2, 6)]
    expect(findWeakestMeasures(song)).toMatchObject({ startMeasure: 1, endMeasure: 2 })
  })

  it('a igualdad de precisión por pieza nombra la de más notas', () => {
    const song = [
      measure(1, 2, 6, {
        kick: { perfect: 1, close: 0, miss: 1 },
        hihat: { perfect: 1, close: 0, miss: 5 },
        snare: { perfect: 0, close: 0, miss: 0 },
      }),
    ]
    expect(findWeakestMeasures(song)?.group).toBe('hihat')
  })
})

describe('distributionOf', () => {
  it('porcentajes enteros que suman 100', () => {
    expect(distributionOf({ perfect: 1, close: 1, miss: 1 })).toEqual({
      perfect: 34,
      close: 33,
      miss: 33,
    })
    expect(distributionOf({ perfect: 74, close: 19, miss: 7 })).toEqual({
      perfect: 74,
      close: 19,
      miss: 7,
    })
  })

  it('sin notas evaluadas es null', () => {
    expect(distributionOf({ perfect: 0, close: 0, miss: 0 })).toBeNull()
  })
})

describe('timingTendency', () => {
  it('a tiempo, tarde o temprano según la media', () => {
    expect(timingTendency(null)).toBeNull()
    expect(timingTendency(3)).toEqual({ text: 'vas a tiempo', tone: 'perfect' })
    expect(timingTendency(14)).toEqual({ text: 'tiendes a ir tarde', tone: 'close' })
    expect(timingTendency(-9)).toEqual({ text: 'tiendes a ir temprano', tone: 'close' })
  })
})

describe('starsFor', () => {
  it('una estrella por umbral alcanzado', () => {
    expect(starsFor(null)).toBe(0)
    expect(starsFor(0.39)).toBe(0)
    expect(starsFor(0.91)).toBe(4) // la maqueta: 91 % → 4 estrellas
    expect(starsFor(1)).toBe(5)
    STAR_THRESHOLDS.forEach((min, i) => expect(starsFor(min)).toBe(i + 1))
  })
})

describe('buildHeadline', () => {
  const sections = (verso: number | null, coro: number | null): SectionPrecision[] => [
    { name: 'Verso 1', startMeasure: 1, precision: verso },
    { name: 'Coro 1', startMeasure: 9, precision: coro },
  ]

  it('primera partida según la precisión', () => {
    expect(buildHeadline({ precision: 0.9, sections: [] }, null)).toBe('¡Gran primera partida!')
    expect(buildHeadline({ precision: 0.8, sections: [] }, null)).toBe(
      'Buen comienzo: ya tienes la base',
    )
    expect(buildHeadline({ precision: 0.5, sections: [] }, null)).toBe(
      'Primera partida: la siguiente sale mejor',
    )
  })

  it('sin notas evaluadas', () => {
    expect(buildHeadline({ precision: null, sections: [] }, null)).toBe('No se evaluó ninguna nota')
  })

  it('mejora: nombra la sección que más subió', () => {
    expect(
      buildHeadline(
        { precision: 0.91, sections: sections(0.92, 0.9) },
        { precision: 0.84, sections: sections(0.9, 0.78) },
      ),
    ).toBe('Buen trabajo: mejoraste en Coro 1')
  })

  it('mejora repartida: da los puntos de precisión', () => {
    expect(
      buildHeadline(
        { precision: 0.87, sections: sections(0.87, 0.87) },
        { precision: 0.84, sections: sections(0.84, 0.84) },
      ),
    ).toBe('Buen trabajo: tu precisión subió 3 puntos')
  })

  it('retroceso: señala la sección más floja', () => {
    expect(
      buildHeadline(
        { precision: 0.7, sections: sections(0.8, 0.6) },
        { precision: 0.8, sections: sections(0.8, 0.8) },
      ),
    ).toBe('Hoy costó más: Coro 1 pide práctica')
  })

  it('igual que la última vez', () => {
    const current = { precision: 0.9, sections: sections(0.9, 0.9) }
    expect(buildHeadline(current, { precision: 0.89, sections: [] })).toBe(
      'Sólido: mantienes el nivel',
    )
    expect(
      buildHeadline(
        { precision: 0.75, sections: sections(0.9, 0.6) },
        { precision: 0.76, sections: [] },
      ),
    ).toBe('Como la última vez: Coro 1 pide práctica')
  })

  it('la partida anterior sin precisión cuenta como primera', () => {
    expect(buildHeadline({ precision: 0.9, sections: [] }, { precision: null, sections: [] })).toBe(
      '¡Gran primera partida!',
    )
  })
})

describe('mapa de calor por compás', () => {
  it('una barra por compás, con hueco en los compases sin notas', () => {
    expect(measureBars([measure(1, 4, 0), measure(3, 1, 1)], 4)).toEqual([
      { measure: 1, precision: 1 },
      { measure: 2, precision: null },
      { measure: 3, precision: 0.5 },
      { measure: 4, precision: null },
    ])
  })

  it('las secciones se reparten por compases', () => {
    expect(
      measureSpans(
        [
          { name: 'Intro', startMeasure: 1, endMeasure: 2 },
          { name: 'Verso', startMeasure: 3, endMeasure: 8 },
        ],
        8,
      ),
    ).toEqual([
      { name: 'Intro', start: 0, end: 0.25 },
      { name: 'Verso', start: 0.25, end: 1 },
    ])
    expect(measureSpans([], 0)).toEqual([])
  })
})

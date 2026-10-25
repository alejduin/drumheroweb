import { describe, expect, it } from 'vitest'
import { matchAnalysisFiles } from '@/game/localAnalysis'

const files = (...names: string[]) => names.map(name => ({ name }))

describe('análisis local', () => {
  it('reconoce la salida del worker', () => {
    const match = matchAnalysisFiles(
      files('chart.json', 'drums.ogg', 'backing.ogg', 'peaks.json', 'run.json', 'Mi canción.mp3'),
    )
    expect(match.ok).toBe(true)
    if (!match.ok) return
    expect(match.files.chart.name).toBe('chart.json')
    expect(match.files.drums?.name).toBe('drums.ogg')
    expect(match.files.backing?.name).toBe('backing.ogg')
    expect(match.files.peaks?.name).toBe('peaks.json')
    expect(match.files.original?.name).toBe('Mi canción.mp3')
  })

  it('basta con chart.json y el MP3 original', () => {
    const match = matchAnalysisFiles(files('Chart.JSON', 'cancion.mp3'))
    expect(match.ok && match.files.drums).toBeNull()
    expect(match.ok && match.files.original?.name).toBe('cancion.mp3')
  })

  it('explica lo que falta', () => {
    expect(matchAnalysisFiles(files('drums.ogg', 'backing.ogg'))).toEqual({
      ok: false,
      error: 'falta chart.json (se recibieron: drums.ogg, backing.ogg)',
    })
    expect(matchAnalysisFiles([])).toEqual({
      ok: false,
      error: 'falta chart.json (se recibieron: ninguno)',
    })
    expect(matchAnalysisFiles(files('chart.json', 'drums.ogg', 'peaks.json'))).toEqual({
      ok: false,
      error: 'faltan los stems (drums y backing) o el MP3 original',
    })
  })

  it('tolera copias del navegador y un chart con otro nombre', () => {
    const copies = matchAnalysisFiles(
      files('chart (1).json', 'drums (1).ogg', 'backing (1).ogg', 'peaks (2).json'),
    )
    expect(copies.ok && copies.files.chart.name).toBe('chart (1).json')
    expect(copies.ok && copies.files.drums?.name).toBe('drums (1).ogg')
    expect(copies.ok && copies.files.peaks?.name).toBe('peaks (2).json')
    // un único JSON que no es peaks hace de chart
    const renamed = matchAnalysisFiles(files('Seven Nation Army.json', 'peaks.json', 'cancion.mp3'))
    expect(renamed.ok && renamed.files.chart.name).toBe('Seven Nation Army.json')
    // con varios JSON candidatos no adivina
    expect(matchAnalysisFiles(files('a.json', 'b.json', 'x.mp3')).ok).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import type { JobSummary } from '@/types'
import { initialTracker } from '@/library/jobTracker'
import type { TrackerState } from '@/library/jobTracker'
import { lowConfidenceHint, piecesText, stageRows, trackerHeadline } from '@/library/importView'
import { makeJob } from '../fakes/FakeWorkerClient'

const summary = (patch: Partial<JobSummary>): JobSummary => ({
  bpm: 104,
  timeSignature: [4, 4],
  durationS: 200,
  pieces: [],
  lowConfidenceCount: 0,
  lowConfidenceByPiece: {},
  ...patch,
})

describe('panel de análisis', () => {
  it('sin trabajo todavía: 5 etapas en espera con los textos del diseño', () => {
    const rows = stageRows(null)
    expect(rows.map(r => r.label)).toEqual([
      'Separar la batería del resto',
      'Detectar golpes por pieza',
      'Detectar tempo y compases',
      'Cuantizar a la rejilla',
      'Generar 3 dificultades',
    ])
    expect(rows.every(r => r.state === 'pending')).toBe(true)
  })

  it('refleja las etapas del worker; la que corre sin avance dice "en curso"', () => {
    const job = makeJob('transcribing')
    job.stages[0] = { ...job.stages[0], state: 'done', progress: 1 }
    job.stages[1] = { ...job.stages[1], state: 'running', progress: 0 }
    const tracker: TrackerState = { ...initialTracker('j'), job }
    const rows = stageRows(tracker)
    expect(rows.map(r => r.state)).toEqual(['done', 'running', 'pending', 'pending', 'pending'])
    expect(rows[1].statusText).toBe('en curso')
    job.stages[1] = { ...job.stages[1], progress: 0.62 }
    expect(stageRows(tracker)[1].statusText).toBeUndefined()
  })

  it('al descargar o terminar todas las etapas están listas', () => {
    const tracker: TrackerState = { ...initialTracker('j'), phase: 'downloading' }
    expect(stageRows(tracker).every(r => r.state === 'done')).toBe(true)
  })

  it('titular según la fase', () => {
    expect(trackerHeadline(initialTracker())).toMatch(/Subiendo/)
    expect(trackerHeadline({ ...initialTracker('j'), job: makeJob('queued') })).toBe('En cola…')
    expect(trackerHeadline({ ...initialTracker('j'), networkFailures: 2 })).toMatch(/reintentando/)
    expect(
      trackerHeadline({
        ...initialTracker('j'),
        phase: 'failed',
        error: { code: 'TOO_LONG', message: 'dura más de 10 min' },
      }),
    ).toBe('dura más de 10 min')
    expect(trackerHeadline({ ...initialTracker('j'), phase: 'done', cached: true })).toMatch(
      /ya estaba/,
    )
  })

  it('agrupa las piezas como el diseño', () => {
    expect(
      piecesText(['kick', 'snare', 'hihat_closed', 'hihat_open', 'tom1', 'tom3', 'crash']),
    ).toBe('Bombo, caja, hi-hat, toms, crash')
    expect(piecesText([])).toBe('—')
  })

  it('dice qué grupo tiene más notas dudosas', () => {
    const hint = lowConfidenceHint(
      summary({
        lowConfidenceCount: 9,
        lowConfidenceByPiece: { tom1: 3, tom2: 3, snare: 4, crash: 0 },
      }),
    )
    expect(hint).toBe('baja confianza, sobre todo toms')
    expect(lowConfidenceHint(summary({}))).toBe('todo con buena confianza')
  })
})

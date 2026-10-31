import { describe, expect, it } from 'vitest'
import type { JobSummary } from '@/types'
import { initialTracker } from '@/library/jobTracker'
import type { TrackerState } from '@/library/jobTracker'
import {
  lowConfidenceHint,
  piecesText,
  stageElapsedS,
  stageRows,
  stageSummary,
  totalElapsedS,
  trackerHeadline,
} from '@/library/importView'
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

  describe('tiempo transcurrido', () => {
    // Creado a las 19:43:32, en la etapa de tempo desde las 19:58:08
    const created = '2026-10-31T19:43:32.000+00:00'
    const stageStart = '2026-10-31T19:58:08.000+00:00'
    const at = (iso: string) => Date.parse(iso)
    const running = (): TrackerState => {
      const job = makeJob('tempo', { createdAt: created, updatedAt: stageStart })
      job.stages[0] = { ...job.stages[0], label: 'Separar', state: 'done', progress: 1 }
      job.stages[1] = { ...job.stages[1], label: 'Golpes', state: 'done', progress: 1 }
      job.stages[2] = { ...job.stages[2], label: 'Tempo', state: 'running', progress: 0 }
      return { ...initialTracker('j'), job }
    }
    const now = at('2026-10-31T20:02:18.000Z')

    it('la etapa en curso cuenta desde el último cambio de etapa', () => {
      expect(stageElapsedS(running(), now)).toBe(250)
      expect(stageRows(running(), now)[2].statusText).toBe('en curso · 4:10')
      // Sin hora no cambia el texto de antes
      expect(stageRows(running())[2].statusText).toBe('en curso')
    })

    it('el total cuenta desde que se creó el trabajo', () => {
      expect(totalElapsedS(running(), now)).toBe(1126)
      expect(trackerHeadline(running(), { nowMs: now })).toBe('Analizando… 18:46 en total')
    })

    it('un reloj local atrasado nunca da tiempo negativo', () => {
      expect(stageElapsedS(running(), at(stageStart) - 5000)).toBe(0)
    })

    it('en cola o terminado no hay tiempo de etapa', () => {
      const queued = { ...initialTracker('j'), job: makeJob('queued', { createdAt: created }) }
      expect(stageElapsedS(queued, now)).toBeNull()
      expect(trackerHeadline(queued, { nowMs: now })).toBe('En cola… 18:46 en total')
      expect(stageElapsedS({ ...running(), phase: 'downloading' }, now)).toBeNull()
      expect(stageElapsedS(initialTracker('j'), now)).toBeNull()
    })

    it('fecha ilegible: se muestra sin tiempo', () => {
      const tracker = running()
      tracker.job = { ...tracker.job!, updatedAt: 'x' }
      expect(stageRows(tracker, now)[2].statusText).toBe('en curso')
    })
  })

  it('avisa si el worker dejó de responder durante el análisis', () => {
    const tracker = { ...initialTracker('j'), job: makeJob('transcribing') }
    expect(trackerHeadline(tracker, { workerOffline: true })).toMatch(/no responde/)
    // Fuera del análisis el aviso no aplica
    expect(trackerHeadline(initialTracker(), { workerOffline: true })).toMatch(/Subiendo/)
  })

  it('resumen de la Biblioteca: etapa, número y tiempo', () => {
    const job = makeJob('tempo', { updatedAt: '2026-10-31T19:58:08Z' })
    job.stages[2] = { ...job.stages[2], label: 'Detectar tempo y compases', state: 'running' }
    const tracker: TrackerState = { ...initialTracker('j'), job }
    expect(stageSummary(tracker, { nowMs: Date.parse('2026-10-31T20:02:18Z') })).toBe(
      '3/5 · Detectar tempo y compases · 4:10',
    )
    expect(stageSummary(tracker)).toBe('3/5 · Detectar tempo y compases')
    expect(stageSummary(tracker, { workerOffline: true })).toMatch(/no responde/)
    expect(stageSummary({ ...initialTracker('j'), job: makeJob('queued') })).toBe('En cola…')
    expect(stageSummary(null)).toBe('Analizando…')
  })
})
